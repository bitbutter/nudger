import type { Nudger, ReferenceFile, Reply, ReplyStatus, Template } from '../types';
import type { RunState } from '../lib/runManager';
import { NudgerCard } from './NudgerCard';

type NudgerBoardProps = {
  nudgers: Nudger[];
  files: ReferenceFile[];
  replies: Reply[];
  templates: Template[];
  runStates: Record<string, RunState>;
  documentId: string;
  focusedNudgerId: string | null;
  hasKey: boolean;
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
  onOpenSettings: () => void;
};

export function NudgerBoard(props: NudgerBoardProps) {
  const { nudgers } = props;
  const starters = props.templates.filter((template) => template.builtin);

  return (
    <section className="nudger-board" aria-label="Nudgers">
      <header className="section-head">
        <div>
          <h2>
            Nudgers <span className="count">{nudgers.length}</span>
          </h2>
          <p className="section-sub">
            Independent virtual repliers. Each has its own prompt, files, budget and history.
          </p>
        </div>
        <div className="section-actions">
          <button
            type="button"
            className="btn btn-sm"
            onClick={props.onRunAll}
            disabled={nudgers.length === 0}
            title="Run all enabled nudgers (Ctrl+Shift+Enter)"
          >
            Run all
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={props.onAddNudger}>
            + Add nudger
          </button>
        </div>
      </header>

      {nudgers.length === 0 ? (
        <div className="empty-board">
          <div className="empty-board-copy">
            <h3>No nudgers yet</h3>
            <p>
              A nudger reads your draft and answers with a question, critique or suggestion. Pick a
              starter below, then edit its prompt and attach reference files. Model output is never
              inserted into your document.
            </p>
          </div>
          <div className="starter-grid">
            {starters.map((template) => (
              <article className="starter-card" key={template.id}>
                <div>
                  <h4>{template.name}</h4>
                  <p>{template.description}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => props.onAddFromTemplate(template)}
                >
                  Add
                </button>
              </article>
            ))}
          </div>
          <div className="empty-board-actions">
            <button type="button" className="btn btn-sm" onClick={props.onAddNudger}>
              Create a blank nudger
            </button>
            <a className="text-link" href="#/templates">
              Manage prompt templates
            </a>
          </div>
        </div>
      ) : (
        <div className="nudger-grid">
          {nudgers.map((nudger, index) => {
            const rawState = props.runStates[nudger.id];
            const state = rawState?.documentId === props.documentId ? rawState : undefined;
            const busyElsewhere = Boolean(
              rawState &&
                rawState.documentId !== props.documentId &&
                rawState.phase !== 'error',
            );
            return (
            <NudgerCard
              key={nudger.id}
              nudger={nudger}
              index={index}
              total={nudgers.length}
              fileCount={nudger.fileIds.length}
              replies={props.replies.filter((reply) => reply.nudgerId === nudger.id)}
              state={state}
              busyElsewhere={busyElsewhere}
              focused={props.focusedNudgerId === nudger.id}
              hasKey={props.hasKey}
              onFocus={() => props.onFocusNudger(nudger.id)}
              onRun={() => props.onRunNudger(nudger)}
              onCancel={() => props.onCancelNudger(nudger.id)}
              onPreview={() => props.onPreviewNudger(nudger)}
              onEdit={() => props.onEditNudger(nudger)}
              onDuplicate={() => props.onDuplicateNudger(nudger)}
              onDelete={() => props.onDeleteNudger(nudger)}
              onMove={(direction) => props.onMoveNudger(nudger, direction)}
              onUpdate={(patch) => props.onUpdateNudger(nudger, patch)}
              onClearHistory={() => props.onClearHistory(nudger)}
              onReplyStatus={props.onReplyStatus}
              onRetry={() => props.onRetryNudger(nudger)}
              onOpenSettings={props.onOpenSettings}
            />
            );
          })}
        </div>
      )}

      <p className="board-hint">
        Plain-text replies only. Copy what helps; nudger never writes into the editor. Every prompt
        resolves placeholders at run time.
      </p>
    </section>
  );
}
