/**
 * The split view's draft column width. Kept in localStorage (not IndexedDB)
 * because it is a per-device display preference, like the sidebar state.
 */

export const EDITOR_WIDTH_KEY = 'nudger.editorWidth';
/**
 * Comfortable line length when nothing has been dragged yet. On a 1440 px window
 * this leaves one nudger column; wider windows get two or more without dragging.
 */
export const DEFAULT_EDITOR_WIDTH = 640;
export const MIN_EDITOR_WIDTH = 320;
export const MIN_NUDGER_WIDTH = 320;
/** Width of the drag handle between the two columns, in px. */
export const SPLITTER_WIDTH = 24;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Keeps the draft readable and leaves room for at least one nudger column.
 * `containerWidth` is the measured width of the two-column layout.
 */
export function clampEditorWidth(width: number, containerWidth?: number): number {
  const usable = Number.isFinite(containerWidth) && (containerWidth ?? 0) > 0;
  const max = usable
    ? Math.max(MIN_EDITOR_WIDTH, Math.round((containerWidth as number) - MIN_NUDGER_WIDTH - SPLITTER_WIDTH))
    : Number.POSITIVE_INFINITY;
  const wanted = Number.isFinite(width) ? width : DEFAULT_EDITOR_WIDTH;
  return Math.round(Math.min(Math.max(wanted, MIN_EDITOR_WIDTH), max));
}

export function readEditorWidth(storage: StorageLike | null = defaultStorage()): number | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(EDITOR_WIDTH_KEY);
    if (raw === null) return null;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveEditorWidth(width: number, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(EDITOR_WIDTH_KEY, String(Math.round(width)));
  } catch {
    // A full or blocked localStorage must not break resizing.
  }
}
