import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Nudger, ReferenceFile, Template } from '../types';
import { store } from '../lib/storage';
import { downloadText, formatChars, formatRelative, wordCount } from '../lib/util';
import { looksBinary, uniqueFileName, validateFileName } from '../lib/referenceFiles';
import { ConfirmDialog, Modal } from './Modal';
import { useToast } from './Toast';

type FilesPanelProps = {
  /** The nudger that owns these files. */
  nudger: Nudger;
  /** That nudger's files, in attachment order. */
  files: ReferenceFile[];
  templates: Template[];
  onClose: () => void;
};

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function FilesPanel({ nudger, files, templates, onClose }: FilesPanelProps) {
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
        (`${nudger.system}
${nudger.prompt}`.toLowerCase().includes(token) ? 1 : 0) +
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
      const created = await store.createFile(nudger.id, newName, newContent);
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
    const existing = files.map((file) => file.name);
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
          const created = await store.createFile(nudger.id, name, text);
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
    await store.deleteFile(selected.id);
    setDeleteOpen(false);
    setSelectedId(null);
    notify(`Deleted ${selected.name}.`, 'success');
  };

  return (
    <section className="panel-section files-panel" aria-labelledby="files-panel-title">
      <header className="section-head">
        <div>
          <h2 id="files-panel-title">
            Reference files <span className="count">{files.length}</span>
          </h2>
          <p className="section-sub">
            Files owned by “{nudger.name}”. Only these files can reach this nudger; other nudgers
            have their own. Stored in this browser, and sent only inside a prompt you preview and
            run.
          </p>
        </div>
        <div className="section-actions">
          <button type="button" className="btn btn-sm" onClick={openNew}>
            New file
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => uploadRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : 'Upload .txt / .md'}
          </button>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Close
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
            Add notes, a job posting, an outline or a sources list for this document. Only plain text
            and Markdown are supported; contents are copied into IndexedDB, not linked to a disk path.
          </p>
          <div className="section-actions">
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
                {filtered.map((file, index) => (
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
                    <span className="file-item-actions">
                      <button
                        type="button"
                        className="icon-btn small"
                        onClick={() => void store.moveFile(nudger.id, file.id, -1)}
                        disabled={index === 0}
                        aria-label={`Move ${file.name} up`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="icon-btn small"
                        onClick={() => void store.moveFile(nudger.id, file.id, 1)}
                        disabled={index === filtered.length - 1}
                        aria-label={`Move ${file.name} down`}
                      >
                        ↓
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="field-note">
              {files.length} file{files.length === 1 ? '' : 's'} in this document
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
                  <span>Owned by “{nudger.name}”.</span>
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
          message={`This file belongs to “${nudger.name}”. Deleting it removes it from that nudger. Old replies keep their resolved prompts.`}
          confirmLabel="Delete file"
          danger
          onClose={() => setDeleteOpen(false)}
          onConfirm={() => void deleteFile()}
        />
      ) : null}
    </section>
  );
}
