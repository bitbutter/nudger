import type { CSSProperties, MouseEvent } from 'react';
import type { Nudger, Reply, ReplyStatus } from '../types';
import type { RunState } from '../lib/runManager';
import { runStateMessage } from '../lib/runManager';
import { copyText, formatRelative } from '../lib/util';
import { GENERIC_FACTS_FOCUS } from '../lib/facts';
import { useToast } from './Toast';

type NudgerCardProps = {
  nudger: Nudger;
  index: number;
  total: number;
  fileCount: number;
  replies: Reply[];
  state: RunState | undefined;
  busyElsewhere?: boolean;
  focused: boolean;
  hasKey: boolean;
  onFocus: () => void;
  onRun: () => void;
  onCancel: () => void;
  onPreview: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  onUpdate: (patch: Partial<Nudger>) => void;
  onClearHistory: () => void;
  onReplyStatus: (reply: Reply, status: ReplyStatus) => void;
  onRetry: () => void;
  onOpenSettings: () => void;
};

function errorTitle(state: RunState): string {
  switch (state.error?.kind) {
    case 'auth':
      return 'The provider rejected the API key';
    case 'config':
      return 'Configuration needed';
    case 'cors':
      return 'The browser could not reach the provider';
    case 'rate_limit':
      return 'The provider rate-limited this run';
    case 'timeout':
      return 'The request timed out';
    case 'context':
      return 'The prompt is too large for the model';
    case 'storage':
      return 'Could not save the reply';
    case 'server':
      return 'The provider had a server error';
    default:
      return 'The run failed';
  }
}

function closeMenu(event: MouseEvent<HTMLButtonElement>) {
  event.currentTarget.closest('details')?.removeAttribute('open');
}

function statusBadge(reply: Reply) {
  if (reply.status === 'new') return null;
  return <span className={`chip chip-${reply.status}`}>{reply.status}</span>;
}

type ReplyItemProps = {
  reply: Reply;
  compact?: boolean;
  onStatus: (reply: Reply, status: ReplyStatus) => void;
  onRetry: () => void;
};

function ReplyItem({ reply, compact, onStatus, onRetry }: ReplyItemProps) {
  const { notify } = useToast();

  const copy = async () => {
    const ok = await copyText(reply.text);
    notify(ok ? 'Reply copied.' : 'Could not copy. Select the text and copy it manually.', ok ? 'success' : 'error');
  };
  const copyPrompt = async () => {
    const ok = await copyText(reply.resolvedPrompt);
    notify(ok ? 'Resolved prompt copied.' : 'Could not copy the prompt.', ok ? 'success' : 'error');
  };
  const copyFacts = async () => {
    const facts = reply.facts ?? [];
    const text = [
      'Facts to check (model-generated; verify against the source):',
      ...facts.map((fact) => `- ${fact}`),
    ].join('\n');
    const ok = await copyText(text);
    notify(ok ? 'Fact clues copied.' : 'Could not copy the fact clues.', ok ? 'success' : 'error');
  };

  return (
    <article className={`reply ${compact ? 'reply-compact' : ''} reply-${reply.status}`}>
      <header className="reply-meta">
        <span>{formatRelative(reply.createdAt)}</span>
        {statusBadge(reply)}
        <span className="reply-model" title={`Provider: ${reply.provider}`}>
          {reply.model}
        </span>
        {reply.usage && (reply.usage.inputTokens != null || reply.usage.outputTokens != null) ? (
          <span className="reply-usage" title="Provider-reported token usage">
            {reply.usage.inputTokens ?? '?'} in / {reply.usage.outputTokens ?? '?'} out
          </span>
        ) : null}
      </header>
      <div className="reply-text">{reply.text}</div>
      {reply.facts && reply.facts.length > 0 ? (
        <div className="reply-facts">
          <div className="reply-facts-head">
            <span>Facts to check</span>
            <span className="reply-facts-note">behind this nudge · model-generated; verify</span>
            <button type="button" className="link-btn" onClick={copyFacts}>
              Copy
            </button>
          </div>
          <ul>
            {reply.facts.map((fact, index) => (
              <li key={`${index}-${fact}`}>{fact}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {reply.factsError ? <p className="reply-facts-error">{reply.factsError}</p> : null}
      <div className="reply-actions">
        <button type="button" className="link-btn" onClick={copy}>
          Copy
        </button>
        <button
          type="button"
          className="link-btn"
          onClick={() => onStatus(reply, reply.status === 'pinned' ? 'new' : 'pinned')}
        >
          {reply.status === 'pinned' ? 'Unpin' : 'Pin'}
        </button>
        {reply.status !== 'archived' ? (
          <button type="button" className="link-btn" onClick={() => onStatus(reply, 'archived')}>
            Archive
          </button>
        ) : (
          <button type="button" className="link-btn" onClick={() => onStatus(reply, 'new')}>
            Unarchive
          </button>
        )}
        {reply.status === 'dismissed' ? (
          <button type="button" className="link-btn" onClick={() => onStatus(reply, 'new')}>
            Undismiss
          </button>
        ) : (
          <button type="button" className="link-btn" onClick={() => onStatus(reply, 'dismissed')}>
            Dismiss
          </button>
        )}
        <button
          type="button"
          className="link-btn"
          onClick={onRetry}
          title="Starts a new run and uses one reply from the budget"
        >
          Run again
        </button>
      </div>
      <details className="reply-prompt">
        <summary>Prompt sent</summary>
        <pre>{reply.resolvedPrompt}</pre>
        <button type="button" className="btn btn-sm" onClick={copyPrompt}>
          Copy prompt
        </button>
      </details>
    </article>
  );
}

export function NudgerCard({
  nudger,
  index,
  total,
  fileCount,
  replies,
  state,
  busyElsewhere,
  focused,
  hasKey,
  onFocus,
  onRun,
  onCancel,
  onPreview,
  onEdit,
  onDuplicate,
  onDelete,
  onMove,
  onUpdate,
  onClearHistory,
  onReplyStatus,
  onRetry,
  onOpenSettings,
}: NudgerCardProps) {
  const busy = state?.phase === 'queued' || state?.phase === 'running' || state?.phase === 'retrying';
  const used = replies.length;
  const budgetLeft = Math.max(0, nudger.budget - used);
  const active = replies.filter((reply) => reply.status === 'new' || reply.status === 'pinned');
  const latest = active[0];
  const older = replies.filter((reply) => reply.id !== latest?.id);
  const blocked = !nudger.enabled || nudger.done || budgetLeft === 0;
  const style = { '--accent': nudger.color } as CSSProperties;

  return (
    <article
      className={`nudger-card ${focused ? 'focused' : ''} ${nudger.enabled ? '' : 'disabled-card'} ${
        busy ? 'busy' : ''
      }`}
      style={style}
      aria-label={`Nudger ${nudger.name}`}
      onFocusCapture={onFocus}
      onMouseDown={onFocus}
    >
      <header className="card-top">
        <div className="card-title-row">
          <span className="accent-dot" aria-hidden="true" />
          <h3 className="card-name">{nudger.name}</h3>
        </div>
        <div className="card-chips">
          <span className="chip" title="Reference files attached">
            {fileCount} file{fileCount === 1 ? '' : 's'}
          </span>
          <span
            className={`chip ${budgetLeft === 0 ? 'chip-warn' : ''}`}
            title="Replies used / allowance for this document"
          >
            {used}/{nudger.budget}
          </span>
          {nudger.autoRun ? <span className="chip chip-auto">auto</span> : null}
          {nudger.facts ? <span className="chip chip-auto">facts</span> : null}
          {busyElsewhere ? <span className="chip chip-warn">in another doc</span> : null}
          {nudger.done ? <span className="chip chip-done">done</span> : null}
          {!nudger.enabled ? <span className="chip">off</span> : null}
        </div>
      </header>

      {nudger.description ? <p className="card-description">{nudger.description}</p> : null}

      <div className={`card-status ${busy ? 'is-busy' : ''} ${state?.phase === 'error' ? 'is-error' : ''}`}>
        {busy && state ? (
          <>
            <span className="spinner" aria-hidden="true" />
            <span>{runStateMessage(state)}</span>
          </>
        ) : state?.phase === 'error' && state.error ? (
          <span>{errorTitle(state)}</span>
        ) : nudger.done ? (
          <span>Done — generation stopped</span>
        ) : !nudger.enabled ? (
          <span>Disabled</span>
        ) : budgetLeft === 0 ? (
          <span>Budget used ({used}/{nudger.budget}) — add more to keep going</span>
        ) : latest ? (
          <span>Last reply {formatRelative(latest.createdAt)}</span>
        ) : (
          <span>Ready</span>
        )}
        {budgetLeft === 0 && !nudger.done ? (
          <button type="button" className="btn btn-sm" onClick={() => onUpdate({ budget: nudger.budget + 3 })}>
            More +3
          </button>
        ) : null}
      </div>

      {state?.phase === 'error' && state.error ? (
        <div className="run-error" role="alert">
          <p>{state.error.message}</p>
          {state.error.detail ? (
            <details>
              <summary>Technical detail</summary>
              <pre>{state.error.detail}</pre>
            </details>
          ) : null}
          <div className="run-error-actions">
            <button type="button" className="btn btn-sm" onClick={onRun} disabled={nudger.done || !nudger.enabled}>
              Retry
            </button>
            {['auth', 'config', 'cors', 'context'].includes(state.error.kind) ? (
              <button type="button" className="btn btn-sm" onClick={onOpenSettings}>
                Open settings
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="card-reply">
        {latest ? (
          <ReplyItem reply={latest} onStatus={onReplyStatus} onRetry={onRetry} />
        ) : replies.length > 0 ? (
          <p className="reply-placeholder">No active reply — dismissed or archived replies are in History.</p>
        ) : busy ? (
          <p className="reply-placeholder">Reading the draft and preparing a nudge…</p>
        ) : (
          <p className="reply-placeholder">
            No reply yet.{' '}
            {!hasKey
              ? 'Add an API key in Settings, then run this nudger.'
              : 'Run this nudger when you want a question or critique.'}
          </p>
        )}
        {older.length > 0 ? (
          <details className="reply-history">
            <summary>
              History ({older.length}
              {older.some((reply) => reply.status === 'archived') ? ', includes archived' : ''})
            </summary>
            <div className="reply-history-list">
              {older.map((reply) => (
                <ReplyItem
                  key={reply.id}
                  reply={reply}
                  compact
                  onStatus={onReplyStatus}
                  onRetry={onRetry}
                />
              ))}
            </div>
          </details>
        ) : null}
      </div>

      <footer className="card-actions">
        <button
          type="button"
          className={`btn btn-sm ${busy ? 'btn-danger' : 'btn-primary'}`}
          onClick={busy ? onCancel : onRun}
          disabled={!busy && (blocked || busyElsewhere)}
          title={
            busyElsewhere
              ? 'This nudger is running for another document. Switch back to cancel it.'
              : nudger.done
              ? 'This nudger is marked done. Reopen it from the menu.'
              : !nudger.enabled
                ? 'This nudger is disabled.'
                : budgetLeft === 0
                  ? 'Reply budget used. Add more allowance.'
                  : 'Run this nudger'
          }
        >
          {busy ? 'Cancel' : 'Run'}
        </button>
        <button type="button" className="btn btn-sm" onClick={onPreview}>
          Preview
        </button>
        <button type="button" className="btn btn-sm" onClick={onEdit}>
          Edit
        </button>
        <details className="menu card-menu">
          <summary className="btn btn-sm menu-summary" aria-label={`${nudger.name} menu`}>
            ⋯
          </summary>
          <div className="menu-panel">
            <button type="button" onClick={(event) => { onMove(-1); closeMenu(event); }} disabled={index === 0}>
              Move left
            </button>
            <button
              type="button"
              onClick={(event) => { onMove(1); closeMenu(event); }}
              disabled={index === total - 1}
            >
              Move right
            </button>
            <button type="button" onClick={(event) => { onDuplicate(); closeMenu(event); }}>
              Duplicate
            </button>
            <button
              type="button"
              onClick={(event) => { onUpdate({ autoRun: !nudger.autoRun }); closeMenu(event); }}
            >
              Auto-run: {nudger.autoRun ? 'on' : 'off'}
            </button>
            <button
              type="button"
              onClick={(event) => { onUpdate({ enabled: !nudger.enabled }); closeMenu(event); }}
            >
              {nudger.enabled ? 'Disable nudger' : 'Enable nudger'}
            </button>
            <button
              type="button"
              onClick={(event) => { onUpdate({ done: !nudger.done }); closeMenu(event); }}
            >
              {nudger.done ? 'Reopen (not done)' : 'Mark done'}
            </button>
            <button
              type="button"
              onClick={(event) => {
                onUpdate({
                  facts: !nudger.facts,
                  ...(!nudger.facts && !(nudger.factsPrompt ?? '').trim()
                    ? { factsPrompt: GENERIC_FACTS_FOCUS }
                    : {}),
                });
                closeMenu(event);
              }}
            >
              Facts to check: {nudger.facts ? 'on' : 'off'}
            </button>
            <button
              type="button"
              onClick={(event) => { onUpdate({ budget: nudger.budget + 3 }); closeMenu(event); }}
            >
              Add 3 to budget
            </button>
            <button
              type="button"
              onClick={(event) => { onClearHistory(); closeMenu(event); }}
              disabled={replies.length === 0}
            >
              Clear history
            </button>
            <button
              type="button"
              className="danger-text"
              onClick={(event) => { onDelete(); closeMenu(event); }}
            >
              Delete nudger
            </button>
          </div>
        </details>
      </footer>
    </article>
  );
}
