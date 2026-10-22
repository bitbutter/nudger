/**
 * Auto-run fires only when both conditions hold: the typing cooldown has
 * elapsed and the pointer has moved. The movement may happen during or after
 * the cooldown, but it must come after the last keystroke, so a mouse resting
 * on the page never triggers a recalculation by itself.
 *
 * Returns a cancel function. It is safe to call after the trigger fired.
 */
export type AutoRunTriggerOptions = {
  delayMs: number;
  onReady: () => void;
  /** Defaults to window; tests pass their own event target. */
  target?: EventTarget;
};

export function createAutoRunTrigger(options: AutoRunTriggerOptions): () => void {
  const target = options.target ?? (typeof window === 'undefined' ? null : window);
  let cooled = false;
  let moved = false;
  let done = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onMove = () => {
    moved = true;
    maybeReady();
  };

  const cleanup = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    target?.removeEventListener('pointermove', onMove);
  };

  function maybeReady() {
    if (done || !cooled || !moved) return;
    done = true;
    cleanup();
    options.onReady();
  }

  target?.addEventListener('pointermove', onMove);
  timer = setTimeout(() => {
    timer = null;
    cooled = true;
    maybeReady();
  }, Math.max(0, options.delayMs));

  return cleanup;
}
