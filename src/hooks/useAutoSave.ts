import { useCallback, useEffect, useRef, useState } from 'react';

export type AutoSaveStatus = 'saved' | 'pending' | 'saving' | 'error';

export type AutoSaveState = {
  status: AutoSaveStatus;
  /** Message from the last failed write; null while everything is saved. */
  error: string | null;
  /** When the last successful write happened; null until something is written. */
  savedAt: number | null;
  /** Signature of the last value that reached the store. */
  savedSignature: string;
  /** Write the pending value now instead of waiting for the debounce. */
  flush: () => Promise<void>;
};

type Options = {
  /** Debounce window in milliseconds. */
  delay?: number;
  /** false pauses autosave, for example while a field is invalid. */
  enabled?: boolean;
};

function signatureOf(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'undefined';
  } catch {
    return String(value);
  }
}

/**
 * Debounced autosave for forms: the value on screen is the value in the store a
 * moment later, and the UI can say when that last happened. The value a form
 * mounts with counts as already saved, so opening a page never writes.
 */
export function useAutoSave<T>(
  value: T,
  save: (value: T) => Promise<void>,
  options: Options = {},
): AutoSaveState {
  const { delay = 700, enabled = true } = options;
  const signature = signatureOf(value);
  const [state, setState] = useState<Omit<AutoSaveState, 'flush'>>({
    status: 'saved',
    error: null,
    savedAt: null,
    savedSignature: signature,
  });

  const latest = useRef({ value, signature });
  latest.current = { value, signature };
  const saveRef = useRef(save);
  saveRef.current = save;
  const savedSignature = useRef(signature);
  const savedAt = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const queued = useRef(false);

  const write = useCallback(async () => {
    if (saving.current) {
      queued.current = true;
      return;
    }
    const { value: current, signature: currentSignature } = latest.current;
    if (currentSignature === savedSignature.current) return;
    saving.current = true;
    setState((prev) => ({ ...prev, status: 'saving', error: null }));
    try {
      await saveRef.current(current);
      savedSignature.current = currentSignature;
      savedAt.current = Date.now();
      const upToDate = latest.current.signature === currentSignature;
      setState({
        status: upToDate ? 'saved' : 'pending',
        error: null,
        savedAt: savedAt.current,
        savedSignature: currentSignature,
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      saving.current = false;
      if (queued.current) {
        queued.current = false;
        if (latest.current.signature !== savedSignature.current) void write();
      }
    }
  }, []);

  useEffect(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (signature === savedSignature.current) {
      // An external value change put the form back in step with the store.
      setState((prev) =>
        prev.status === 'saved'
          ? prev
          : {
              status: 'saved',
              error: null,
              savedAt: savedAt.current,
              savedSignature: savedSignature.current,
            },
      );
      return;
    }
    if (!enabled) return;
    setState((prev) => (prev.status === 'pending' ? prev : { ...prev, status: 'pending' }));
    timer.current = setTimeout(() => {
      timer.current = null;
      void write();
    }, delay);
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [signature, enabled, delay, write]);

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    await write();
  }, [write]);

  return { ...state, flush };
}
