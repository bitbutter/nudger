import { GENERIC_FACTS_FOCUS } from '../lib/facts';

type FactsFieldsProps = {
  enabled: boolean;
  focus: string;
  disabled?: boolean;
  onChange: (patch: { facts?: boolean; factsPrompt?: string }) => void;
};

/**
 * Shared fact-clue controls for a nudger or a template. The extraction format is
 * fixed; only the focus is editable, so the JSON parser stays reliable.
 */
export function FactsFields({ enabled, focus, disabled, onChange }: FactsFieldsProps) {
  const value = (focus || GENERIC_FACTS_FOCUS).trim() || GENERIC_FACTS_FOCUS;
  return (
    <section className="facts-fields" aria-label="Fact clues">
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              facts: event.target.checked,
              ...(event.target.checked && !focus.trim() ? { factsPrompt: GENERIC_FACTS_FOCUS } : {}),
            })
          }
        />
        <span>Add a “Facts to check” list under each reply</span>
      </label>
      <p className="field-note">
        The reply and the fact list come back in one JSON response from the same request. If the
        model ignores the format, the plain reply is kept and the fact list is marked missing. Clues
        are model-generated; verify them against the source.
      </p>
      {enabled ? (
        <>
          <label className="field">
            <span>What should the list focus on?</span>
            <textarea
              className="textarea"
              rows={3}
              value={value}
              disabled={disabled}
              onChange={(event) => onChange({ factsPrompt: event.target.value })}
            />
          </label>
          <div className="facts-actions">
            <button
              type="button"
              className="btn btn-sm"
              disabled={disabled}
              onClick={() => onChange({ factsPrompt: GENERIC_FACTS_FOCUS })}
            >
              Use generic focus
            </button>
            <span className="field-note">
              The output format is fixed (strict JSON, at most five clues); only this focus is
              editable.
            </span>
          </div>
        </>
      ) : null}
    </section>
  );
}
