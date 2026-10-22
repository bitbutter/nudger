import { useCallback, useEffect, useRef, useState } from 'react';
import type { Document } from '../types';
import { describeStorageError, store } from '../lib/storage';

const AUTOSAVE_MS = 450;

/**
 * Draft text lives in React state and is mirrored to IndexedDB after a short
 * pause. Switching documents flushes the previous draft first, so the last
 * keystrokes are never dropped.
 */
export function useDraft(doc: Document | null, onError: (message: string) => void) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [editSeq, setEditSeq] = useState(0);
  const pending = useRef<{ docId: string; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docIdRef = useRef<string | null>(null);
  const writingRef = useRef(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const job = pending.current;
    if (!job) return;
    pending.current = null;
    writingRef.current = true;
    try {
      await store.updateDocumentText(job.docId, job.text);
    } catch (error) {
      onErrorRef.current(describeStorageError(error));
    } finally {
      writingRef.current = false;
      // A new edit may have arrived while the write was in flight.
      if (!pending.current) setSaving(false);
    }
  }, []);

  useEffect(() => {
    if (!doc) {
      docIdRef.current = null;
      setText('');
      setEditSeq(0);
      return;
    }
    if (docIdRef.current === doc.id) return;
    docIdRef.current = doc.id;
    setText(doc.currentText);
    setSaving(false);
    setEditSeq(0);
    return () => {
      void flush();
    };
  }, [doc?.id, flush]);

  // Apply external changes (another tab, import) only when nothing local is
  // pending or in flight, and the writer is not actively typing.
  useEffect(() => {
    if (!doc || docIdRef.current !== doc.id || pending.current || writingRef.current) return;
    const active = typeof document === 'undefined' ? null : document.activeElement;
    if (active instanceof HTMLElement && active.classList.contains('editor-area')) return;
    setText((current) => (current === doc.currentText ? current : doc.currentText));
  }, [doc?.id, doc?.currentText]);

  useEffect(() => {
    const onHide = () => {
      void flush();
    };
    window.addEventListener('pagehide', onHide);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      void flush();
    };
  }, [flush]);

  const change = useCallback(
    (value: string) => {
      const id = docIdRef.current;
      if (!id) return;
      setText(value);
      pending.current = { docId: id, text: value };
      setSaving(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush();
      }, AUTOSAVE_MS);
      setEditSeq((seq) => seq + 1);
    },
    [flush],
  );

  /** Used after a restore/import has already written the new text to IndexedDB. */
  const replaceText = useCallback((value: string) => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    pending.current = null;
    setText(value);
    setSaving(false);
    setEditSeq(0);
  }, []);

  return { text, change, replaceText, saving, editSeq, flush };
}
