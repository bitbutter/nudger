import type { Caret } from '../types';
import { wordCount } from './util';

export type SelectionScope = {
  /** The selected passage, exactly as the nudger will read it. */
  text: string;
  /** Caret and selection mapped into the passage: it ends at the cursor. */
  caret: Caret;
  /** Words in the passage, for the board notice. */
  words: number;
};

/**
 * A deliberate run uses the selected passage instead of the whole draft when the
 * writer has a real selection. The selection is the scope, so nudgers respond to
 * that span only; clearing the selection goes back to the whole draft.
 *
 * A whitespace-only or empty selection is not a scope: it would send an empty
 * draft, so it falls back to the whole document instead.
 */
export function selectionScope(text: string, caret: Caret): SelectionScope | null {
  const length = text.length;
  const start = Math.max(0, Math.min(caret.start, caret.end, length));
  const end = Math.min(length, Math.max(caret.start, caret.end));
  if (end <= start) return null;
  const passage = text.slice(start, end);
  if (!passage.trim()) return null;
  return {
    text: passage,
    // The passage is the whole text of a scoped run, so its own end is where the
    // cursor sits. Whichever way the selection was dragged (backwards included),
    // {{before_cursor}} then reads the passage instead of nothing.
    caret: { start: passage.length, end: passage.length },
    words: wordCount(passage),
  };
}
