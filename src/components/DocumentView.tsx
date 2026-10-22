import { useEffect, useMemo, useRef, useState } from 'react';
import type { Caret, Document, Nudger, ReferenceFile, Reply, ReplyStatus, Template } from '../types';
import type { RunState } from '../lib/runManager';
import { formatRelative, lineColumn, wordCount } from '../lib/util';
import { paragraphAt } from '../lib/placeholders';
import { NudgerBoard } from './NudgerBoard';

type DocumentViewProps = {
  doc: Document;
  text: string;
  caret: Caret;
  saving: boolean;
  versionCount: number;
  hasKey: boolean;
  providerSummary: string;
  layout: 'stacked' | 'side';
  onToggleSidebar: () => void;
  onChangeText: (value: string) => void;
  onCaret: (caret: Caret) => void;
  onRename: (title: string) => void;
  onSaveVersion: () => void;
  onOpenVersions: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOpenSettings: () => void;
  nudgers: Nudger[];
  files: ReferenceFile[];
  replies: Reply[];
  runStates: Record<string, RunState>;
  focusedNudgerId: string | null;
  onFocusNudger: (id: string) => void;
  onRunNudger: (nudger: Nudger) => void;
  onCancelNudger: (id: string) => void;
  onRunAll: () => void;
  onAddNudger: () => void;
  onEditNudger: (nudger: Nudger) => void;
  onPreviewNudger: (nudger: Nudger) => void;
  onDuplicateNudger: (nudger: Nudger) => void;
  onDeleteNudger: (nudger: Nudger) => void;
  onMoveNudger: (nudger: Nudger, direction: -1 | 1) => void;
  onUpdateNudger: (nudger: Nudger, patch: Partial<Nudger>) => void;
  onClearHistory: (nudger: Nudger) => void;
  onReplyStatus: (reply: Reply, status: ReplyStatus) => void;
  onRetryNudger: (nudger: Nudger) => void;
  onAddFromTemplate: (template: Template) => void;
  templates: Template[];
};

export function DocumentView(props: DocumentViewProps) {
  const { doc, text, caret, saving, versionCount, hasKey, providerSummary, layout } = props;
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState(doc.title);
  useEffect(() => {
    setTitle(doc.title);
  }, [doc.id, doc.title]);

  const onCaretRef = useRef(props.onCaret);
  onCaretRef.current = props.onCaret;

  const reportCaret = () => {
    const area = areaRef.current;
    if (!area) return;
    onCaretRef.current({ start: area.selectionStart, end: area.selectionEnd });
  };

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.focus({ preventScroll: true });
    const end = area.value.length;
    area.setSelectionRange(end, end);
    onCaretRef.current({ start: end, end });
    // Only re-place the caret when the document changes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  useEffect(() => {
    const onSelectionChange = () => {
      if (document.activeElement === areaRef.current) reportCaret();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  const words = useMemo(() => wordCount(text), [text]);
  const position = useMemo(() => lineColumn(text, caret.start), [text, caret.start]);
  const selectionLength = Math.max(0, caret.end - caret.start);
  const beforeChars = text.slice(0, Math.min(caret.start, text.length)).length;
  const paragraph = useMemo(() => paragraphAt(text, caret.start), [text, caret.start]);

  const commitTitle = () => {
    const next = title.trim() || 'Untitled document';
    if (next !== doc.title) props.onRename(next);
    else setTitle(doc.title);
  };

  return (
    <main className="doc-page">
      <header className="topbar">
        <div className="topbar-lead">
          <button
            type="button"
            className="icon-btn sidebar-toggle"
            onClick={props.onToggleSidebar}
            aria-label="Toggle sidebar"
            title="Toggle sidebar (Ctrl+B)"
          >
            ☰
          </button>
          <div className="title-block">
            <label className="sr-only" htmlFor="document-title">
              Document title
            </label>
            <input
              id="document-title"
              className="doc-title-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
                if (event.key === 'Escape') {
                  setTitle(doc.title);
                  event.currentTarget.blur();
                }
              }}
              placeholder="Untitled document"
            />
            <div className="topbar-meta">
              <span>{saving ? 'Saving…' : `Saved ${formatRelative(doc.updatedAt)}`}</span>
              <span aria-hidden="true">·</span>
              <span>{words.toLocaleString()} words</span>
              <span aria-hidden="true">·</span>
              <span>
                {versionCount} version{versionCount === 1 ? '' : 's'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="provider-summary">{providerSummary}</span>
            </div>
          </div>
        </div>
        <div className="topbar-actions">
          <button type="button" className="btn" onClick={props.onSaveVersion} title="Save version (Ctrl+S)">
            Save version
          </button>
          <button type="button" className="btn" onClick={props.onOpenVersions}>
            Versions
          </button>
          <details className="menu">
            <summary className="btn menu-summary" aria-label="Document menu">
              Document
            </summary>
            <div className="menu-panel">
              <button type="button" onClick={props.onDuplicate}>
                Duplicate document
              </button>
              <button type="button" className="danger-text" onClick={props.onDelete}>
                Delete document
              </button>
            </div>
          </details>
        </div>
      </header>

      {!hasKey ? (
        <div className="banner banner-warn">
          <span>
            No API key yet. Add one in Settings to let nudgers read your draft. Nothing is sent until
            you run a nudger, and the resolved prompt is what gets sent.
          </span>
          <button type="button" className="btn btn-sm btn-primary" onClick={props.onOpenSettings}>
            Open settings
          </button>
        </div>
      ) : null}

      <div className={`doc-layout layout-${layout}`}>
        <div className="editor-column">
          <section className="editor-card" aria-label="Draft editor">
            <textarea
              ref={areaRef}
              className="editor-area"
              value={text}
              onChange={(event) => {
                props.onChangeText(event.target.value);
                props.onCaret({
                  start: event.currentTarget.selectionStart,
                  end: event.currentTarget.selectionEnd,
                });
              }}
              onClick={reportCaret}
              onKeyUp={reportCaret}
              onSelect={reportCaret}
              spellCheck
              placeholder="Start writing. Place the cursor where you want the nudgers to read. Nothing is written for you."
              aria-describedby="editor-status"
            />
            <footer className="editor-foot" id="editor-status">
              <div className="editor-stats">
                <span>{words.toLocaleString()} words</span>
                <span>{text.length.toLocaleString()} chars</span>
                <span>
                  line {position.line}, col {position.column}
                </span>
                <span>{selectionLength > 0 ? `${selectionLength.toLocaleString()} selected` : 'no selection'}</span>
              </div>
              <div className="context-indicator" title="These values fill placeholders at run time">
                <span>
                  before cursor: {beforeChars.toLocaleString()} chars
                </span>
                <span>paragraph: {paragraph.length.toLocaleString()} chars</span>
                <span>cursor at {caret.start.toLocaleString()}</span>
              </div>
            </footer>
          </section>
        </div>

        <NudgerBoard
          nudgers={props.nudgers}
          files={props.files}
          replies={props.replies}
          templates={props.templates}
          runStates={props.runStates}
          documentId={doc.id}
          focusedNudgerId={props.focusedNudgerId}
          hasKey={hasKey}
          onFocusNudger={props.onFocusNudger}
          onRunNudger={props.onRunNudger}
          onCancelNudger={props.onCancelNudger}
          onRunAll={props.onRunAll}
          onAddNudger={props.onAddNudger}
          onEditNudger={props.onEditNudger}
          onPreviewNudger={props.onPreviewNudger}
          onDuplicateNudger={props.onDuplicateNudger}
          onDeleteNudger={props.onDeleteNudger}
          onMoveNudger={props.onMoveNudger}
          onUpdateNudger={props.onUpdateNudger}
          onClearHistory={props.onClearHistory}
          onReplyStatus={props.onReplyStatus}
          onRetryNudger={props.onRetryNudger}
          onAddFromTemplate={props.onAddFromTemplate}
          onOpenSettings={props.onOpenSettings}
        />
      </div>
    </main>
  );
}
