import { useMemo, useRef, useState } from 'react';
import type { Caret, Nudger, ProviderId, ReferenceFile, Settings, Template } from '../types';
import { Modal } from './Modal';
import { FactsFields } from './FactsFields';
import { NUDGER_COLORS, DEFAULT_NUDGER_COLOR } from '../lib/starters';
import { PROVIDER_PRESETS, getProviderPreset } from '../lib/providers';
import {
  CONTEXT_PLACEHOLDERS,
  CONTEXT_PLACEHOLDER_HELP,
  META_PLACEHOLDERS,
  META_PLACEHOLDER_HELP,
  hasContextPlaceholder,
  listFilePlaceholders,
} from '../lib/placeholders';
import { prepareRun } from '../lib/run';
import { clamp, formatChars } from '../lib/util';
import { formatFileStats, nudgerFiles } from '../lib/referenceFiles';
import { GENERIC_FACTS_FOCUS } from '../lib/facts';
import { useAutoSave } from '../hooks/useAutoSave';
import { SaveStatus } from './SaveStatus';
import { useToast } from './Toast';

type NudgerEditorProps = {
  mode: 'create' | 'edit';
  initial: Nudger;
  files: ReferenceFile[];
  templates: Template[];
  settings: Settings;
  document: { id: string; title: string; currentText: string } | null;
  caret: Caret;
  onClose: () => void;
  onSave: (nudger: Nudger) => Promise<void>;
  /** Edit mode only: persist changes as they are made, without closing. */
  onAutoSave: (nudger: Nudger) => Promise<void>;
  onSaveAsTemplate: (nudger: Nudger) => Promise<void>;
  onDuplicateAsNew: (nudger: Nudger) => Promise<void>;
};

export function NudgerEditor({
  mode,
  initial,
  files,
  templates,
  settings,
  document,
  caret,
  onClose,
  onSave,
  onAutoSave,
  onSaveAsTemplate,
  onDuplicateAsNew,
}: NudgerEditorProps) {
  const { notify } = useToast();
  const [draft, setDraft] = useState<Nudger>(() => ({ ...initial, fileIds: [...initial.fileIds] }));
  const [saving, setSaving] = useState(false);
  const canAutosave = mode === 'edit' && Boolean(draft.name.trim()) && Boolean(draft.prompt.trim());
  const [templateChoice, setTemplateChoice] = useState(initial.templateId ?? '');
  const [insertChoice, setInsertChoice] = useState('{{files}}');
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const patch = (next: Partial<Nudger>) => setDraft((current) => ({ ...current, ...next }));
  const updateDraft = (next: Partial<Nudger>) => patch(next);

  const attached = nudgerFiles(draft, files);
  const resolvedTemplate = templates.find((template) => template.id === draft.templateId);
  const chosenTemplate = templates.find((template) => template.id === templateChoice);

  const prepared = useMemo(
    () =>
      prepareRun({
        nudger: draft,
        document: document ?? { id: 'preview', title: 'No document open', currentText: '' },
        caret,
        files,
        settings,
      }),
    [draft, document, caret, files, settings],
  );

  const contextMissing = !hasContextPlaceholder(`${draft.system}\n${draft.prompt}`);
  const allFilePlaceholders = listFilePlaceholders(`${draft.system}\n${draft.prompt}`);
  const hasFilePlaceholder = allFilePlaceholders.length > 0;
  const unreferenced = hasFilePlaceholder
    ? attached.filter((file) => {
        if (allFilePlaceholders.includes(null)) return false;
        const names = allFilePlaceholders.filter((name): name is string => Boolean(name));
        return !names.some((name) => name.toLowerCase() === file.name.toLowerCase());
      })
    : [];

  const insertOptions = [
    { value: '{{files}}', label: '{{files}} — all attached files' },
    ...attached.map((file) => ({ value: `{{file:${file.name}}}`, label: `{{file:${file.name}}}` })),
  ];

  const loadTemplate = (templateId: string, quiet = false) => {
    const template = templates.find((item) => item.id === templateId);
    if (!template) {
      notify('That template no longer exists.', 'warn');
      return;
    }
    patch({
      system: template.system,
      prompt: template.prompt,
      description: template.description,
      templateId: template.id,
      facts: template.facts === true,
      factsPrompt: template.factsPrompt?.trim() || GENERIC_FACTS_FOCUS,
    });
    setTemplateChoice(template.id);
    if (!quiet) notify(`Loaded “${template.name}” into this nudger.`, 'success');
  };

  const moveFile = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      const next = [...current.fileIds];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return { ...current, fileIds: next };
    });
  };

  const insertPlaceholder = () => {
    const textarea = promptRef.current;
    const token = insertOptions.some((option) => option.value === insertChoice)
      ? insertChoice
      : '{{files}}';
    const start = textarea ? textarea.selectionStart : draft.prompt.length;
    const end = textarea ? textarea.selectionEnd : draft.prompt.length;
    const next = draft.prompt.slice(0, start) + token + draft.prompt.slice(end);
    patch({ prompt: next });
    requestAnimationFrame(() => {
      const area = promptRef.current;
      if (!area) return;
      area.focus();
      const position = start + token.length;
      area.setSelectionRange(position, position);
    });
  };

  const cleaned = (source: Nudger = draft): Nudger | null => {
    const draft = source;
    if (!draft.name.trim()) {
      notify('Give this nudger a name.', 'warn');
      return null;
    }
    if (!draft.prompt.trim()) {
      notify('The user prompt cannot be empty.', 'warn');
      return null;
    }
    return {
      ...draft,
      name: draft.name.trim(),
      description: draft.description?.trim() || undefined,
      color: draft.color || DEFAULT_NUDGER_COLOR,
      fileIds: draft.fileIds.filter((id) => files.some((file) => file.id === id)),
      providerId: draft.providerId || undefined,
      model: draft.model?.trim() || undefined,
      system: draft.system,
      prompt: draft.prompt,
      temperature: clamp(draft.temperature, 0, 2),
      maxTokens: Math.round(clamp(draft.maxTokens, 1, 64_000)),
      maxContextChars: Math.round(clamp(draft.maxContextChars, 1_000, 2_000_000)),
      facts: draft.facts === true,
      factsPrompt: draft.factsPrompt?.trim() || GENERIC_FACTS_FOCUS,
    };
  };

  const save = async () => {
    const value = cleaned();
    if (!value) return;
    setSaving(true);
    try {
      await onSave(value);
    } finally {
      setSaving(false);
    }
  };

  // Editing an existing nudger needs no Save button: each change is written to
  // the document's nudger row, and the footer says when that last happened.
  const autoSave = useAutoSave(
    draft,
    async (next) => {
      const value = cleaned(next);
      if (!value) throw new Error('A nudger needs a name and a user prompt.');
      await onAutoSave(value);
    },
    { enabled: canAutosave, delay: 800 },
  );

  const close = () => {
    void autoSave.flush();
    onClose();
  };

  const saveTemplate = async () => {
    const value = cleaned();
    if (!value) return;
    await onSaveAsTemplate(value);
  };

  const duplicateAsNew = async () => {
    const value = cleaned();
    if (!value) return;
    await onDuplicateAsNew(value);
  };

  const providerForModel = getProviderPreset(draft.providerId ?? settings.providerId);

  return (
    <Modal
      title={mode === 'create' ? 'New nudger' : `Edit ${initial.name}`}
      subtitle="Its prompt is resolved against the document and attached files at the moment you run it."
      onClose={close}
      size="xl"
      footer={
        mode === 'create' ? (
          <>
            <button type="button" className="btn" onClick={close}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Create nudger'}
            </button>
          </>
        ) : (
          <>
            <SaveStatus state={autoSave} />
            <button type="button" className="btn btn-primary" onClick={close}>
              Done
            </button>
          </>
        )
      }
    >
      <div className="editor-split">
        <div className="form-column">
          <div className="field-row">
            <label className="field grow">
              <span>Name</span>
              <input
                className="input"
                value={draft.name}
                onChange={(event) => patch({ name: event.target.value })}
                placeholder="Completeness coach"
              />
            </label>
            <div className="field color-field">
              <span>Color</span>
              <div className="swatches" role="group" aria-label="Nudger color">
                {NUDGER_COLORS.map((colour) => (
                  <button
                    key={colour.value}
                    type="button"
                    className={`swatch ${draft.color === colour.value ? 'active' : ''}`}
                    style={{ background: colour.value }}
                    onClick={() => patch({ color: colour.value })}
                    aria-label={colour.name}
                    aria-pressed={draft.color === colour.value}
                  />
                ))}
              </div>
            </div>
          </div>

          <label className="field">
            <span>Description (optional)</span>
            <input
              className="input"
              value={draft.description ?? ''}
              onChange={(event) => patch({ description: event.target.value })}
              placeholder="What this nudger is for"
            />
          </label>

          <div className="template-row">
            <label className="field grow">
              <span>Template</span>
              <select
                className="select"
                value={templateChoice}
                onChange={(event) => setTemplateChoice(event.target.value)}
              >
                <option value="">Choose a template…</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} {template.builtin ? '(starter)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn"
              onClick={() => loadTemplate(templateChoice)}
              disabled={!chosenTemplate}
            >
              Load
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => loadTemplate(draft.templateId ?? '')}
              disabled={!resolvedTemplate}
              title="Replace this nudger's prompt with its template"
            >
              Reset to starter
            </button>
          </div>

          <label className="field">
            <span>System prompt</span>
            <textarea
              className="textarea code"
              rows={4}
              value={draft.system}
              onChange={(event) => patch({ system: event.target.value })}
              placeholder="You are a skeptical reviewer. Do not rewrite the draft."
            />
          </label>

          <div className="field">
            <div className="field-head">
              <span>User prompt</span>
              <span className="field-note">Placeholders resolve at run time.</span>
            </div>
            <textarea
              ref={promptRef}
              className="textarea code prompt-textarea"
              rows={10}
              value={draft.prompt}
              onChange={(event) => patch({ prompt: event.target.value })}
            />
            <div className="insert-row">
              <select
                className="select"
                value={insertChoice}
                onChange={(event) => setInsertChoice(event.target.value)}
                aria-label="File placeholder to insert"
              >
                {insertOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-sm" onClick={insertPlaceholder}>
                Insert file placeholder
              </button>
            </div>
          </div>

          <details className="placeholder-help" open>
            <summary>Available placeholders</summary>
            <p className="placeholder-note">
              With text selected in the draft, a run reads only that selection: every context
              placeholder below then refers to the selection.
            </p>
            <div className="placeholder-table">
              {CONTEXT_PLACEHOLDERS.map((name) => (
                <div key={name}>
                  <code>{`{{${name}}}`}</code>
                  <span>{CONTEXT_PLACEHOLDER_HELP[name]}</span>
                </div>
              ))}
              {META_PLACEHOLDERS.map((name) => (
                <div key={name}>
                  <code>{`{{${name}}}`}</code>
                  <span>{META_PLACEHOLDER_HELP[name]}</span>
                </div>
              ))}
              <div>
                <code>{'{{files}}'}</code>
                <span>All attached files, in the order listed below, each in a reference wrapper.</span>
              </div>
              <div>
                <code>{'{{file:name.txt}}'}</code>
                <span>One attached file by exact name. Missing or unattached files block the run.</span>
              </div>
            </div>
          </details>

          <section className="field">
            <div className="field-head">
              <span>This nudger's reference files</span>
              <span className="field-note">{formatFileStats(attached)}</span>
            </div>
            {attached.length > 0 ? (
              <ol className="attached-list">
                {draft.fileIds.map((id, index) => {
                  const file = files.find((item) => item.id === id);
                  if (!file) return null;
                  return (
                    <li key={id}>
                      <span className="attached-name">{file.name}</span>
                      <span className="attached-stats">{file.wordCount.toLocaleString()} words</span>
                      <button
                        type="button"
                        className="icon-btn small"
                        onClick={() => moveFile(index, -1)}
                        disabled={index === 0}
                        aria-label={`Move ${file.name} up`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="icon-btn small"
                        onClick={() => moveFile(index, 1)}
                        disabled={index === draft.fileIds.length - 1}
                        aria-label={`Move ${file.name} down`}
                      >
                        ↓
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="field-note">No files yet.</p>
            )}
            <p className="field-note">
              Files belong to this nudger and only this nudger can read them. Add, edit, reorder or
              delete them with the file button on its card after saving.
            </p>
          </section>

          <div className="field-row">
            <label className="field">
              <span>Provider</span>
              <select
                className="select"
                value={draft.providerId ?? ''}
                onChange={(event) =>
                  patch({ providerId: (event.target.value || undefined) as ProviderId | undefined })
                }
              >
                <option value="">Use Settings default</option>
                {PROVIDER_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field grow">
              <span>Model override</span>
              <input
                className="input"
                value={draft.model ?? ''}
                onChange={(event) => patch({ model: event.target.value })}
                placeholder={`Settings default: ${settings.model || providerForModel.defaultModel}`}
              />
            </label>
          </div>
          <p className="field-note">
            The API key always comes from Settings. A per-nudger provider uses that provider’s preset
            base URL.
          </p>

          <div className="field-row">
            <label className="field">
              <span>Temperature</span>
              <input
                className="input"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={draft.temperature}
                onChange={(event) =>
                  patch({ temperature: Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0 })
                }
              />
            </label>
            <label className="field">
              <span>Max tokens</span>
              <input
                className="input"
                type="number"
                min={1}
                max={64000}
                value={draft.maxTokens}
                onChange={(event) =>
                  patch({ maxTokens: Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 1 })
                }
              />
            </label>
            <label className="field grow">
              <span>Max context characters</span>
              <input
                className="input"
                type="number"
                min={1000}
                step={1000}
                value={draft.maxContextChars}
                onChange={(event) =>
                  patch({
                    maxContextChars: Number.isFinite(event.target.valueAsNumber)
                      ? event.target.valueAsNumber
                      : 100000,
                  })
                }
              />
            </label>
          </div>

          <FactsFields
            enabled={draft.facts === true}
            focus={draft.factsPrompt || GENERIC_FACTS_FOCUS}
            onChange={(patch) => updateDraft(patch)}
          />

          <div className="checkbox-stack">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.autoRun}
                onChange={(event) => patch({ autoRun: event.target.checked })}
              />
              <span>
                Auto-run about {(settings.autoRunDelayMs / 1000).toFixed(1)}s after typing stops, once
                the mouse moves. Turn it off to run this nudger by hand only.
              </span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => patch({ enabled: event.target.checked })}
              />
              <span>Enabled (off means it is skipped by Run all and auto-run)</span>
            </label>
          </div>

          <div className="editor-extras">
            <button type="button" className="btn btn-sm" onClick={saveTemplate}>
              Save as template
            </button>
            {mode === 'edit' ? (
              <button type="button" className="btn btn-sm" onClick={duplicateAsNew}>
                Duplicate as new nudger
              </button>
            ) : null}
          </div>
        </div>

        <aside className="preview-column" aria-label="Live resolved prompt preview">
          <div className="preview-column-head">
            <h3>Live preview</h3>
            <span className="field-note">
              {formatChars(prepared.totalChars)} chars · ~{formatChars(prepared.estimatedTokens)} tokens
            </span>
          </div>

          {contextMissing ? (
            <p className="issue issue-warn">
              No document context placeholder. The model will not see your draft unless you add one,
              such as {'{{before_cursor}}'} or {'{{full_text}}'}.
            </p>
          ) : null}
          {hasFilePlaceholder && unreferenced.length > 0 ? (
            <p className="issue issue-warn">
              Attached but not referenced, so not sent: {unreferenced.map((file) => file.name).join(', ')}.
              Use {'{{files}}'} or a matching {'{{file:name}}'} placeholder.
            </p>
          ) : null}
          {!hasFilePlaceholder && attached.length > 0 ? (
            <p className="issue issue-info">
              No file placeholder, so all {attached.length} attached file(s) are appended automatically.
            </p>
          ) : null}
          {prepared.overLimit ? (
            <p className="issue issue-block">
              {formatChars(prepared.totalChars)} chars exceeds the {formatChars(prepared.maxContextChars)}{' '}
              limit. You can run anyway or trim from the preview dialog.
            </p>
          ) : null}
          {prepared.configError ? <p className="issue issue-block">{prepared.configError}</p> : null}
          {prepared.issues
            .filter((issue) => issue.kind !== 'unreferenced-file')
            .map((issue, index) => (
              <p
                className={`issue ${issue.blocking ? 'issue-block' : 'issue-warn'}`}
                key={`${issue.kind}-${index}`}
              >
                {issue.message}
              </p>
            ))}

          <div className="preview-model">
            <span>{prepared.resolved.preset.label}</span>
            <code>{prepared.resolved.model || '(no model)'}</code>
            <span>{prepared.sentFiles.length} file(s) sent</span>
          </div>

          <section className="preview-block">
            <div className="preview-block-head">
              <h4>System</h4>
            </div>
            <pre>{prepared.system.trim() || '(none)'}</pre>
          </section>
          <section className="preview-block">
            <div className="preview-block-head">
              <h4>User</h4>
            </div>
            <pre>{prepared.prompt || '(empty)'}</pre>
          </section>
          {prepared.facts ? (
            <p className="field-note">
              The system prompt above includes the fact-clue JSON protocol. The reply and facts arrive
              in one response; a plain-text response is kept as the reply and marked as having no
              structured fact list.
            </p>
          ) : null}
          <p className="privacy-inline">
            This preview updates as you type. Only this text is sent when the nudger runs.
          </p>
        </aside>
      </div>
    </Modal>
  );
}
