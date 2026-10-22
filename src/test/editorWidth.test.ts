import { describe, expect, it } from 'vitest';
import {
  clampEditorWidth,
  DEFAULT_EDITOR_WIDTH,
  EDITOR_WIDTH_KEY,
  MIN_EDITOR_WIDTH,
  MIN_NUDGER_WIDTH,
  readEditorWidth,
  saveEditorWidth,
  SPLITTER_WIDTH,
} from '../lib/editorWidth';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    data,
  };
}

describe('draft column width preference', () => {
  it('keeps the draft readable and leaves room for a nudger column', () => {
    expect(clampEditorWidth(100, 1400)).toBe(MIN_EDITOR_WIDTH);
    expect(clampEditorWidth(5000, 1400)).toBe(1400 - MIN_NUDGER_WIDTH - SPLITTER_WIDTH);
  });

  it('falls back to the default width for unusable values', () => {
    expect(clampEditorWidth(Number.NaN)).toBe(DEFAULT_EDITOR_WIDTH);
    expect(clampEditorWidth(DEFAULT_EDITOR_WIDTH, 900)).toBe(
      900 - MIN_NUDGER_WIDTH - SPLITTER_WIDTH,
    );
  });

  it('round-trips a stored width', () => {
    const storage = fakeStorage();
    saveEditorWidth(720.6, storage);

    expect(storage.data.get(EDITOR_WIDTH_KEY)).toBe('721');
    expect(readEditorWidth(storage)).toBe(721);
  });

  it('ignores missing, malformed and unavailable storage', () => {
    expect(readEditorWidth(fakeStorage())).toBeNull();
    expect(readEditorWidth(fakeStorage({ [EDITOR_WIDTH_KEY]: 'wide' }))).toBeNull();
    expect(readEditorWidth(null)).toBeNull();
    expect(() => saveEditorWidth(700, null)).not.toThrow();
  });
});
