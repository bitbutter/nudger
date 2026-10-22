import type { AutoSaveState } from '../hooks/useAutoSave';
import { formatRelative } from '../lib/util';

type SaveStatusProps = {
  state: AutoSaveState;
  /** Prefix for the saved line, e.g. "Last saved". */
  label?: string;
};

/**
 * One shared "is it saved?" line for every autosaving form, so the whole app
 * answers the same question the same way.
 */
export function SaveStatus({ state, label = 'Last saved' }: SaveStatusProps) {
  if (state.status === 'error') {
    return (
      <span className="save-status is-error" role="status">
        Not saved: {state.error ?? 'write failed'}
      </span>
    );
  }
  if (state.status === 'saving') {
    return (
      <span className="save-status is-busy" role="status">
        Saving…
      </span>
    );
  }
  if (state.status === 'pending') {
    return (
      <span className="save-status is-pending" role="status">
        Unsaved changes…
      </span>
    );
  }
  return (
    <span className="save-status" role="status">
      {state.savedAt ? `${label}: ${formatRelative(state.savedAt)}` : 'All changes saved'}
    </span>
  );
}
