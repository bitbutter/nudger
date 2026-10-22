import { useMemo, useState } from 'react';
import type { Caret, Settings, Template } from '../types';
import { store } from '../lib/storage';
import { blankTemplate } from '../lib/starters';
import { CONTEXT_PLACEHOLDERS, CONTEXT_PLACEHOLDER_HELP, hasContextPlaceholder, listFilePlaceholders } from '../lib/placeholders';
import { prepareRun } from '../lib/run';
import { newId } from '../lib/util';
import { GENERIC_FACTS_FOCUS } from '../lib/facts';
import { ConfirmDialog, Modal } from './Modal';
import { FactsFields } from './FactsFields';
import { useToast } from './Toast';

type TemplatesPageProps = {
  templates: Template[];
  settings: Settings;
  document: { id: string; title: string; currentText: string } | null;
  caret: Caret;
  onToggleSidebar: () => void;
  onUseTemplate: (template: Template) => void;
};

type EditorState = { mode: 'create' | 'edit' | 'view'; template: Template };

function TemplateEditor({
  state,
  settings,
  document,
  caret,
  onClose,
  onSaved,
  onDuplicate,
  onUse,
}: {
  state: EditorState;
  settings: Settings;
  document: { id: string; title: string; currentText: string } | null;
  caret: Caret;
  onClose: () => void;
  onSaved: () => void;
  onDuplicate: (template: Template) => void;
  onUse: (template: Template) => void;
}) {
  const { notify } = useToast();
  const [draft, setDraft] = useState<Template>({ ...state.template });
  const [saving, setSaving] = useState(false);
  const readOnly = state.mode === 'view';

  const preview = useMemo(() => {
    const tempNudger = {
      id: 'template-preview',
      documentId: 'template-preview',
      name: draft.name || 'Template',
      color: '#7aa2f7',
      system: draft.system,
      prompt: draft.prompt,
      fileIds: [],
      temperature: draft.temperature ?? settings.temperature,
      maxTokens: draft.maxTokens ?? settings.maxTokens,
      maxContextChars: draft.maxContextChars ?? settings.maxContextChars,
      autoRun: false,
      enabled: true,
      done: false,
      budget: 3,
      facts: draft.facts === true,
      factsPrompt: draft.factsPrompt || GENERIC_FACTS_FOCUS,
      order: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    return prepareRun({
      nudger: tempNudger,
      document: document ?? { id: 'preview', title: 'No document', currentText: '' },
      caret,
      files: [],
      settings,
    });
  }, [draft.name, draft.prompt, draft.system, draft.facts, draft.factsPrompt, settings, document, caret]);

  const contextMissing = !hasContextPlaceholder(`${draft.system}\n${draft.prompt}`);
  const filePlaceholders = listFilePlaceholders(`${draft.system}\n${draft.prompt}`);

  const save = async () => {
    if (!draft.name.trim()) {
      notify('Give the template a name.', 'warn');
      return;
    }
    if (!draft.prompt.trim()) {
      notify('The user prompt cannot be empty.', 'warn');
      return;
    }
    setSaving(true);
    try {
      await store.saveTemplate({
        ...draft,
        name: draft.name.trim(),
        description: draft.description.trim(),
        builtin: false,
      });
      notify('Template saved.', 'success');
      onSaved();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={state.mode === 'create' ? 'New template' : draft.name}
      subtitle={readOnly ? 'Read-only starter template. Duplicate it to edit.' : 'Templates are a starting point; a nudger keeps its own copy.'}
      onClose={onClose}
      size="xl"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          {readOnly ? (
            <>
              <button type="button" className="btn" onClick={() => onDuplicate(draft)}>
                Duplicate to my templates
              </button>
              <button type="button" className="btn btn-primary" onClick={() => onUse(draft)}>
                Add as nudger
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save template'}
            </button>
          )}
        </>
      }
    >
      <div className="editor-split">
        <div className="form-column">
          <label className="field">
            <span>Name</span>
            <input
              className="input"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              disabled={readOnly}
            />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea
              className="textarea"
              rows={2}
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              disabled={readOnly}
              placeholder="What it is for, and which file to attach"
            />
          </label>
          <label className="field">
            <span>System prompt</span>
            <textarea
              className="textarea code"
              rows={4}
              value={draft.system}
              onChange={(event) => setDraft({ ...draft, system: event.target.value })}
              disabled={readOnly}
            />
          </label>
          <label className="field">
            <span>User prompt</span>
            <textarea
              className="textarea code prompt-textarea"
              rows={10}
              value={draft.prompt}
              onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
              disabled={readOnly}
            />
          </label>
          <FactsFields
            enabled={draft.facts === true}
            focus={draft.factsPrompt || GENERIC_FACTS_FOCUS}
            disabled={readOnly}
            onChange={(patch) => setDraft({ ...draft, ...patch })}
          />

          <div className="field-row">
            <label className="field">
              <span>Temperature</span>
              <input
                className="input"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={draft.temperature ?? settings.temperature}
                disabled={readOnly}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    temperature: Number.isFinite(event.target.valueAsNumber)
                      ? event.target.valueAsNumber
                      : 0.4,
                  })
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
                value={draft.maxTokens ?? settings.maxTokens}
                disabled={readOnly}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    maxTokens: Number.isFinite(event.target.valueAsNumber)
                      ? event.target.valueAsNumber
                      : 700,
                  })
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
                value={draft.maxContextChars ?? settings.maxContextChars}
                disabled={readOnly}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    maxContextChars: Number.isFinite(event.target.valueAsNumber)
                      ? event.target.valueAsNumber
                      : 100000,
                  })
                }
              />
            </label>
          </div>

          <details className="placeholder-help" open>
            <summary>Available placeholders</summary>
            <div className="placeholder-table">
              {CONTEXT_PLACEHOLDERS.map((name) => (
                <div key={name}>
                  <code>{`{{${name}}}`}</code>
                  <span>{CONTEXT_PLACEHOLDER_HELP[name]}</span>
                </div>
              ))}
              <div>
                <code>{'{{files}}'}</code>
                <span>All files attached to the nudger that uses this template.</span>
              </div>
              <div>
                <code>{'{{file:name.txt}}'}</code>
                <span>One attached file, by exact name.</span>
              </div>
            </div>
          </details>
          {contextMissing ? (
            <p className="issue issue-warn">
              No document context placeholder. Add something like {'{{before_cursor}}'} or the model
              will not see the draft.
            </p>
          ) : null}
          {filePlaceholders.length > 0 ? (
            <p className="issue issue-info">
              This template expects reference files. They are attached per nudger; this preview has
              none, so file placeholders are empty or marked unavailable.
            </p>
          ) : null}
        </div>
        <aside className="preview-column">
          <div className="preview-column-head">
            <h3>Resolved preview</h3>
            <span className="field-note">
              {document ? document.title : 'No document open'}
            </span>
          </div>
          <section className="preview-block">
            <div className="preview-block-head">
              <h4>System</h4>
            </div>
            <pre>{preview.system.trim() || '(none)'}</pre>
          </section>
          <section className="preview-block">
            <div className="preview-block-head">
              <h4>User</h4>
            </div>
            <pre>{preview.prompt || '(empty)'}</pre>
          </section>
          <p className="privacy-inline">
            Placeholders resolve against the current document and cursor when this template is used.
          </p>
        </aside>
      </div>
    </Modal>
  );
}

export function TemplatesPage({
  templates,
  settings,
  document,
  caret,
  onToggleSidebar,
  onUseTemplate,
}: TemplatesPageProps) {
  const { notify } = useToast();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const starters = templates.filter((template) => template.builtin);
  const custom = templates.filter((template) => !template.builtin);
  const deleting = templates.find((template) => template.id === deleteId);

  const duplicate = async (template: Template) => {
    try {
      const copy = await store.saveTemplate({
        ...template,
        id: newId(),
        name: `${template.name} (copy)`,
        builtin: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      notify('Template duplicated into your library.', 'success');
      setEditor({ mode: 'edit', template: copy });
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  const duplicateCustom = duplicate;

  return (
    <main className="page templates-page">
      <header className="page-head">
        <div className="page-head-lead">
          <button type="button" className="icon-btn" onClick={onToggleSidebar} aria-label="Toggle sidebar">
            ☰
          </button>
          <div>
            <h1>Prompt templates</h1>
            <p className="page-sub">
              Short, editable starting points. Starters are read-only; a nudger holds its own copy of
              the prompt, so editing one never changes another.
            </p>
          </div>
        </div>
        <div className="page-head-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setEditor({ mode: 'create', template: blankTemplate() })}
          >
            New template
          </button>
        </div>
      </header>

      <section className="panel-section">
        <h2>Starter library</h2>
        <div className="template-grid">
          {starters.map((template) => (
            <article className="template-card" key={template.id}>
              <div className="template-card-head">
                <h3>{template.name}</h3>
                <span className="chip">starter</span>
              </div>
              <p>{template.description}</p>
              <div className="template-card-actions">
                <button type="button" className="btn btn-sm btn-primary" onClick={() => onUseTemplate(template)}>
                  Add nudger
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setEditor({ mode: 'view', template })}
                >
                  View
                </button>
                <button type="button" className="btn btn-sm" onClick={() => void duplicate(template)}>
                  Duplicate
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <h2>My templates</h2>
        {custom.length === 0 ? (
          <div className="empty-inline">
            <p>
              No custom templates yet. Duplicate a starter, save a nudger as a template, or create one
              from scratch.
            </p>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setEditor({ mode: 'create', template: blankTemplate() })}
            >
              New template
            </button>
          </div>
        ) : (
          <div className="template-grid">
            {custom.map((template) => (
              <article className="template-card" key={template.id}>
                <div className="template-card-head">
                  <h3>{template.name}</h3>
                  <span className="chip chip-auto">custom</span>
                  {template.facts ? <span className="chip chip-auto">facts</span> : null}
                </div>
                <p>{template.description || 'No description.'}</p>
                <div className="template-card-actions">
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => onUseTemplate(template)}>
                    Add nudger
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setEditor({ mode: 'edit', template })}
                  >
                    Edit
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => void duplicateCustom(template)}>
                    Duplicate
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => setDeleteId(template.id)}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {editor ? (
        <TemplateEditor
          key={`${editor.mode}:${editor.template.id}`}
          state={editor}
          settings={settings}
          document={document}
          caret={caret}
          onClose={() => setEditor(null)}
          onSaved={() => setEditor(null)}
          onDuplicate={(template) => void duplicate(template)}
          onUse={(template) => {
            setEditor(null);
            onUseTemplate(template);
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`Delete template “${deleting.name}”?`}
          message="Nudgers already created from this template keep their prompts. This only removes the template from your library."
          confirmLabel="Delete template"
          danger
          onClose={() => setDeleteId(null)}
          onConfirm={async () => {
            try {
              await store.deleteTemplate(deleting.id);
              notify('Template deleted.', 'success');
              setDeleteId(null);
            } catch (error) {
              notify(error instanceof Error ? error.message : String(error), 'error');
            }
          }}
        />
      ) : null}
    </main>
  );
}
