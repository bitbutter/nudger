import { useMemo, useState } from 'react';
import type { Caret, Nudger, ReferenceFile, Settings } from '../types';
import { Modal } from './Modal';
import { prepareRun } from '../lib/run';
import { copyText, formatChars } from '../lib/util';
import { useToast } from './Toast';

type PromptPreviewProps = {
  nudger: Nudger;
  document: { id: string; title: string; currentText: string } | null;
  caret: Caret;
  files: ReferenceFile[];
  settings: Settings;
  /** Rejected nudges for this nudger, so the preview matches the real request. */
  avoid?: string[];
  /** True when the draft column's selection is the scope of this run. */
  selectionScoped?: boolean;
  hasKey: boolean;
  onClose: () => void;
  onRun: (options: { force?: boolean; trim?: boolean }) => void;
};

export function PromptPreview({
  nudger,
  document,
  caret,
  files,
  settings,
  avoid,
  selectionScoped,
  hasKey,
  onClose,
  onRun,
}: PromptPreviewProps) {
  const { notify } = useToast();
  const [trim, setTrim] = useState(false);
  const prepared = useMemo(
    () =>
      prepareRun({
        nudger,
        document: document ?? { id: 'preview', title: 'No document', currentText: '' },
        caret,
        files,
        settings,
        trimToLimit: trim,
        avoid,
        selectionScoped,
      }),
    [nudger, document, caret, files, settings, trim, avoid, selectionScoped],
  );

  const copy = async (text: string, label: string) => {
    const ok = await copyText(text);
    notify(ok ? `${label} copied.` : 'Could not copy. Select the text and copy manually.', ok ? 'success' : 'error');
  };

  const blockingIssues = prepared.issues.filter((issue) => issue.blocking);
  const warnings = prepared.issues.filter((issue) => !issue.blocking);

  return (
    <Modal
      title="Resolved prompt"
      subtitle={`${nudger.name} · ${prepared.resolved.preset.label} · ${prepared.resolved.model || 'no model'}`}
      onClose={onClose}
      size="xl"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn" onClick={() => copy(prepared.fullPrompt, 'Prompt')}>
            Copy prompt
          </button>
          {prepared.overLimit && !trim ? (
            <>
              <button type="button" className="btn" onClick={() => setTrim(true)}>
                Trim (drops middle)
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => onRun({ force: true })}
                disabled={prepared.blocking || !hasKey}
              >
                Run anyway
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onRun({ trim })}
              disabled={prepared.blocking || !hasKey}
            >
              Run
            </button>
          )}
        </>
      }
    >
      <div className="preview-stats">
        <div>
          <span>Prompt size</span>
          <strong>
            {formatChars(prepared.totalChars)} chars · ~{formatChars(prepared.estimatedTokens)} tokens
          </strong>
        </div>
        <div>
          <span>Limit</span>
          <strong>{formatChars(prepared.maxContextChars)} chars</strong>
        </div>
        <div>
          <span>Files sent</span>
          <strong>
            {prepared.sentFiles.length} / {nudger.fileIds.length}
          </strong>
        </div>
        <div>
          <span>File source</span>
          <strong>{prepared.autoAppended ? 'auto-appended' : prepared.hadFilePlaceholder ? 'template placeholders' : 'none'}</strong>
        </div>
        <div>
          <span>Fact clues</span>
          <strong>{prepared.facts ? 'same response' : 'off'}</strong>
        </div>
      </div>

      {prepared.autoAppended ? (
        <p className="issue issue-info">
          The template has no file placeholder, so all {prepared.sentFiles.length} attached file(s)
          were appended under a REFERENCE FILES section.
        </p>
      ) : null}

      {prepared.trimmed ? (
        <p className="issue issue-info">
          The prompt was trimmed in the middle to {formatChars(prepared.maxContextChars)}{' '}
          characters. The text below is exactly what will be sent.
        </p>
      ) : null}

      {prepared.overLimit ? (
        <p className="issue issue-block">
          This prompt is {formatChars(prepared.totalChars - prepared.maxContextChars)} characters over
          the {formatChars(prepared.maxContextChars)} character limit. Nothing is cut automatically.
          Run anyway, or trim the middle of the prompt. The trimmed text is shown here before anything is sent.
        </p>
      ) : null}

      {prepared.configError ? <p className="issue issue-block">{prepared.configError}</p> : null}
      {!hasKey ? (
        <p className="issue issue-block">
          No API key is set. Open Settings and add a key for {prepared.resolved.preset.label}.
        </p>
      ) : null}

      {blockingIssues.map((issue, index) => (
        <p className="issue issue-block" key={`b-${index}`}>
          {issue.message}
        </p>
      ))}
      {warnings.map((issue, index) => (
        <p className="issue issue-warn" key={`w-${index}`}>
          {issue.message}
        </p>
      ))}

      {prepared.sentFiles.length > 0 ? (
        <div className="preview-files">
          <h3>Reference files in this request</h3>
          <ul>
            {prepared.sentFiles.map((file) => (
              <li key={file.id}>
                <span>{file.name}</span>
                <span>{formatChars(file.content.length)} chars</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="preview-grid">
        <section className="preview-block">
          <div className="preview-block-head">
            <h3>System message</h3>
            <button
              type="button"
              className="link-btn"
              onClick={() => copy(prepared.system, 'System message')}
            >
              Copy
            </button>
          </div>
          <pre>{prepared.system.trim() || '(none)'}</pre>
        </section>
        <section className="preview-block">
          <div className="preview-block-head">
            <h3>User message</h3>
            <button type="button" className="link-btn" onClick={() => copy(prepared.prompt, 'User message')}>
              Copy
            </button>
          </div>
          <pre>{prepared.prompt || '(empty)'}</pre>
        </section>
        {prepared.facts ? (
          <p className="issue issue-info">
            Fact clues are requested in the same JSON response: {'{"reply":"...","facts":[...]}'}.
            If the model ignores the format, the plain reply is kept and the fact list is marked
            missing. A malformed JSON response is shown as an error with a retry instead of being
            rendered as text.
          </p>
        ) : null}
      </div>

      <p className="privacy-inline">
        This is the entire request. Only this text is sent, and only to{' '}
        {prepared.resolved.preset.label} when you press Run. The base URL is{' '}
        {prepared.resolved.baseUrl}.
      </p>
    </Modal>
  );
}
