import type { Template } from '../types';
import { Modal } from './Modal';

type AddNudgerModalProps = {
  templates: Template[];
  onPick: (template: Template) => void;
  onBlank: () => void;
  onClose: () => void;
};

export function AddNudgerModal({ templates, onPick, onBlank, onClose }: AddNudgerModalProps) {
  const starters = templates.filter((template) => template.builtin);
  const custom = templates.filter((template) => !template.builtin);
  return (
    <Modal
      title="Add a nudger"
      subtitle="Pick a starting point. You can edit the prompt, files, model and color before saving."
      onClose={onClose}
      size="xl"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={onBlank}>
            Start from a blank template
          </button>
        </>
      }
    >
      <h3 className="subhead">Starter library</h3>
      <div className="starter-grid">
        {starters.map((template) => (
          <article className="starter-card" key={template.id}>
            <div>
              <h4>{template.name}</h4>
              <p>{template.description}</p>
            </div>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => onPick(template)}>
              Use template
            </button>
          </article>
        ))}
      </div>

      {custom.length > 0 ? (
        <>
          <h3 className="subhead">My templates</h3>
          <div className="starter-grid">
            {custom.map((template) => (
              <article className="starter-card" key={template.id}>
                <div>
                  <h4>{template.name}</h4>
                  <p>{template.description || 'No description.'}</p>
                </div>
                <button type="button" className="btn btn-sm" onClick={() => onPick(template)}>
                  Use template
                </button>
              </article>
            ))}
          </div>
        </>
      ) : null}

      <p className="field-note">
        Templates live in the library. A nudger keeps its own copy, so editing one nudger never
        changes another. Manage custom templates on the <a href="#/templates">Templates page</a>.
      </p>
    </Modal>
  );
}
