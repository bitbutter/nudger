import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Nudger, ReferenceFile, Template } from '../types';
import { store } from '../lib/storage';
import { downloadText, formatChars, formatRelative, wordCount } from '../lib/util';
import { looksBinary, uniqueFileName, validateFileName } from '../lib/referenceFiles';
import { ConfirmDialog, Modal } from './Modal';
import { useToast } from './Toast';

type FilesPageProps = {
  files: ReferenceFile[];
  nudgers: Nudger[];
  templates: Template[];
  onToggleSidebar: () => void;
};

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function FilesPage({ files, nudgers, templates, onToggleSidebar }: FilesPageProps) {
  const { notify } = useToast();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('notes.md');
  const [newContent, setNewContent] = useState('');
  const [newError, setNewError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const pending = useRef<{ id: string; content: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writingRef = useRef(false);

  const selected = files.find((file) => file.id === selectedId) ?? null;

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const job = pending.current;
    if (!job) return;
    pending.current = null;
    writingRef.current = true;
    try {
      await store.updateFile(job.id, { content: job.content });
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      writingRef.current = false;
      if (!pending.current) setSaving(false);
    }
  }, [notify]);

  useEffect(() => {
    if (!files.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !files.some((file) => file.id === selectedId)) {
      setSelectedId(files[0].id);
    }
  }, [files, selectedId]);

  useEffect(() => {
    if (!selected) return;
    setNameDraft(selected.name);
    setContent(selected.content);
    // Deliberately keyed by id: a background save must not reset the textarea.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // Pick up external content changes only when no local edit is waiting or
  // in flight, and the file textarea is not focused.
  useEffect(() => {
    if (!selected || pending.current || writingRef.current) return;
    const active = typeof document === 'undefined' ? null : document.activeElement;
    if (active instanceof HTMLElement && active.classList.contains('file-content')) return;
    setContent((current) => (current === selected.content ? current : selected.content));
  }, [selected?.id, selected?.content]);

  useEffect(() => {
    return () => {
      void flush();
    };
  }, [selected?.id, flush]);

  const editContent = (value: string) => {
    setContent(value);
    if (!selected) return;
    pending.current = { id: selected.id, content: value };
    setSaving(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush();
    }, 600);
  };

  const commitName = async () => {
    if (!selected) return;
    if (nameDraft.trim() === selected.name) return;
    const oldName = selected.name;
    try {
      await store.updateFile(selected.id, { name: nameDraft });
      const token = `{{file:${oldName}}}`.toLowerCase();
      const affected =
        nudgers.filter((nudger) =>
          `${nudger.system}
${nudger.prompt}`.toLowerCase().includes(token),
        ).length +
        templates.filter((template) =>
          `${template.system}
${template.prompt}`.toLowerCase().includes(token),
        ).length;
      if (affected > 0) {
        notify(
          `Renamed to ${nameDraft.trim()}. ${affected} nudger(s) or template(s) still reference {{file:${oldName}}}; update the placeholder or the run will block.`,
          'warn',
        );
      } else {
        notify('File renamed.', 'success');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
      setNameDraft(selected.name);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return files;
    return files.filter(
      (file) => file.name.toLowerCase().includes(q) || file.content.toLowerCase().includes(q),
    );
  }, [files, query]);

  const openNew = () => {
    setNewName(uniqueFileName('notes.md', files.map((file) => file.name)));
    setNewContent('');
    setNewError(null);
    setNewOpen(true);
  };

  const createFile = async () => {
    setNewError(null);
    try {
      const created = await store.createFile(newName, newContent);
      setSelectedId(created.id);
      setNewOpen(false);
      notify(`Created ${created.name}.`, 'success');
    } catch (error) {
      setNewError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleUpload = async (input: HTMLInputElement) => {
    const list = Array.from(input.files ?? []);
    input.value = '';
    if (!list.length) return;
    setUploading(true);
    const existing = (await store.listFiles()).map((file) => file.name);
    const messages: string[] = [];
    let lastId: string | null = null;
    let createdCount = 0;
    try {
      for (const file of list) {
        const valid = validateFileName(file.name);
        if (!valid.ok) {
          messages.push(`${file.name}: ${valid.error}`);
          continue;
        }
        if (file.size > MAX_FILE_BYTES) {
          messages.push(`${file.name}: larger than 2 MB.`);
          continue;
        }
        let text: string;
        try {
          text = await file.text();
        } catch {
          messages.push(`${file.name}: could not be read as text.`);
          continue;
        }
        if (looksBinary(text)) {
          messages.push(`${file.name}: looks like a binary file, not text.`);
          continue;
        }
        const name = uniqueFileName(file.name, existing);
        try {
          const created = await store.createFile(name, text);
          existing.push(created.name);
          lastId = created.id;
          createdCount += 1;
          if (name !== file.name) messages.push(`${file.name} saved as ${name} (name already used).`);
        } catch (error) {
          messages.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } finally {
      setUploading(false);
    }
    if (lastId) setSelectedId(lastId);
    if (createdCount > 0) notify(`Uploaded ${createdCount} file${createdCount === 1 ? '' : 's'}.`, 'success');
    if (messages.length) notify(messages.join(' '), 'warn');
  };

  const deleteFile = async () => {
    if (!selected) return;
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    pending.current = null;
    setSaving(false);
    const affected = await store.deleteFile(selected.id);
    setDeleteOpen(false);
    setSelectedId(null);
    notify(
      affected.length
        ? `Deleted ${selected.name} and detached it from ${affected.length} nudger${affected.length === 1 ? '' : 's'}.`
        : `Deleted ${selected.name}.`,
      'success',
    );
  };

  const referencedBy = selected
    ? nudgers.filter((nudger) => nudger.fileIds.includes(selected.id)).map((nudger) => nudger.name)
    : [];

  return (
    <main className="page files-page">
      <header className="page-head">
        <div className="page-head-lead">
          <button type="button" className="icon-btn" onClick={onToggleSidebar} aria-label="Toggle sidebar">
            ☰
          </button>
          <div>
            <h1>Reference files</h1>
            <p className="page-sub">
              A shared library of .txt and .md files. Nudgers attach only what they need. Files are
              stored in this browser and sent only inside a prompt you preview and run.
            </p>
          </div>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn" onClick={openNew}>
            New file
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => uploadRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : 'Upload .txt / .md'}
          </button>
          <input
            ref={uploadRef}
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            multiple
            hidden
            onChange={(event) => void handleUpload(event.currentTarget)}
          />
        </div>
      </header>

      {files.length === 0 ? (
        <div className="empty-page">
          <h2>No reference files yet</h2>
          <p>
            Add notes, a job posting, an outline or a sources list. Only plain text and Markdown are
            supported; contents are copied into IndexedDB, not linked to a disk path.
          </p>
          <div className="page-head-actions">
            <button type="button" className="btn btn-primary" onClick={openNew}>
              Create a file
            </button>
            <button type="button" className="btn" onClick={() => uploadRef.current?.click()}>
              Upload from disk
            </button>
          </div>
        </div>
      ) : (
        <div className="files-layout">
          <aside className="file-list-panel" aria-label="File list">
            <label className="search">
              <span className="sr-only">Search files</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search files"
              />
            </label>
            {filtered.length === 0 ? (
              <p className="field-note">No files match “{query}”.</p>
            ) : (
              <ul className="file-list">
                {filtered.map((file) => (
                  <li key={file.id}>
                    <button
                      type="button"
                      className={`file-item ${file.id === selectedId ? 'active' : ''}`}
                      onClick={() => setSelectedId(file.id)}
                    >
                      <span className="file-item-name">
                        <span className={`file-kind kind-${file.kind}`}>{file.kind}</span>
                        {file.name}
                      </span>
                      <span className="file-item-meta">
                        {formatChars(file.content.length)} chars · {formatRelative(file.updatedAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="field-note">
              {files.length} file{files.length === 1 ? '' : 's'} in the library
            </p>
          </aside>

          <section className="file-editor-panel" aria-label="File editor">
            {selected ? (
              <>
                <div className="file-editor-head">
                  <label className="field grow">
                    <span>File name</span>
                    <input
                      className="input file-name-input"
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.target.value)}
                      onBlur={() => void commitName()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                      }}
                      spellCheck={false}
                    />
                  </label>
                  <div className="file-editor-actions">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => downloadText(selected.name, content, selected.kind === 'md' ? 'text/markdown' : 'text/plain')}
                    >
                      Download
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => setDeleteOpen(true)}>
                      Delete
                    </button>
                  </div>
                </div>
                <div className="file-meta">
                  <span>{selected.kind === 'md' ? 'Markdown' : 'Plain text'}</span>
                  <span>{wordCount(content).toLocaleString()} words</span>
                  <span>{formatChars(content.length)} chars</span>
                  <span>{saving ? 'Saving…' : `Saved ${formatRelative(selected.updatedAt)}`}</span>
                </div>
                <textarea
                  className="textarea code file-content"
                  value={content}
                  onChange={(event) => editContent(event.target.value)}
                  onBlur={() => void flush()}
                  spellCheck
                  aria-label={`Contents of ${selected.name}`}
                />
                <footer className="file-editor-foot">
                  <span>Stored locally in IndexedDB. Editing affects future runs only.</span>
                  {referencedBy.length > 0 ? (
                    <span>
                      Attached to {referencedBy.length} nudger{referencedBy.length === 1 ? '' : 's'}:{' '}
                      {referencedBy.join(', ')}
                    </span>
                  ) : (
                    <span>Not attached to any nudger yet.</span>
                  )}
                </footer>
              </>
            ) : (
              <div className="empty-page">
                <h2>Select a file</h2>
                <p>Choose a file on the left, or create a new one.</p>
              </div>
            )}
          </section>
        </div>
      )}

      {newOpen ? (
        <Modal
          title="New reference file"
          onClose={() => setNewOpen(false)}
          size="lg"
          footer={
            <>
              <button type="button" className="btn" onClick={() => setNewOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={createFile}>
                Create file
              </button>
            </>
          }
        >
          <label className="field">
            <span>File name (.txt or .md)</span>
            <input
              className="input"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void createFile();
              }}
              autoFocus
              spellCheck={false}
            />
          </label>
          {newError ? <p className="issue issue-block">{newError}</p> : null}
          <label className="field">
            <span>Contents (optional — paste text here)</span>
            <textarea
              className="textarea code"
              rows={12}
              value={newContent}
              onChange={(event) => setNewContent(event.target.value)}
              placeholder="Paste or type the reference text."
              spellCheck
            />
          </label>
          <p className="field-note">
            File names must be unique and cannot contain {'{'} or {'}'}.
          </p>
        </Modal>
      ) : null}

      {deleteOpen && selected ? (
        <ConfirmDialog
          title={`Delete ${selected.name}?`}
          message={
            referencedBy.length
              ? `This file is attached to ${referencedBy.length} nudger(s): ${referencedBy.join(', ')}. Deleting it detaches it from those nudgers. Old replies keep their resolved prompts.`
              : 'This removes the file from this browser. Old replies keep their resolved prompts.'
          }
          confirmLabel="Delete file"
          danger
          onClose={() => setDeleteOpen(false)}
          onConfirm={() => void deleteFile()}
        />
      ) : null}
    </main>
  );
}
