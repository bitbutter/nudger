import { describe, expect, it } from 'vitest';
import {
  hasContextPlaceholder,
  listFilePlaceholders,
  paragraphAt,
  resolveTemplateText,
  textBeforeLastWord,
} from '../lib/placeholders';
import { testFile } from './helpers';

const text = 'First paragraph line one.\nline two.\n\nSecond paragraph here.\n\nThird paragraph.';

function resolve(template: string, options: { start?: number; end?: number; files?: ReturnType<typeof testFile>[]; allFileNames?: string[] } = {}) {
  return resolveTemplateText(template, {
    text,
    selectionStart: options.start ?? text.length,
    selectionEnd: options.end ?? options.start ?? text.length,
    documentTitle: 'My essay',
    nudgerName: 'Coach',
    files: options.files ?? [],
    allFileNames: options.allFileNames,
    now: new Date('2026-10-22T12:00:00Z'),
  });
}

describe('cursor placeholders', () => {
  const cursor = text.indexOf('paragraph here') + 'paragraph'.length;

  it('resolves before_cursor up to the exact cursor', () => {
    const out = resolve('Before:\n{{before_cursor}}', { start: cursor });
    expect(out.text).toBe(`Before:\n${text.slice(0, cursor)}`);
    expect(out.text).not.toContain('here.');
  });

  it('resolves after_cursor from the end of the selection', () => {
    const out = resolve('{{before_cursor}}|{{selection}}|{{after_cursor}}', {
      start: cursor,
      end: cursor + 3,
    });
    expect(out.text).toBe(`${text.slice(0, cursor)}|${text.slice(cursor, cursor + 3)}|${text.slice(cursor + 3)}`);
  });

  it('resolves full_text and selection', () => {
    const out = resolve('{{full_text}}\n--\n{{selection}}', { start: 0, end: 14 });
    expect(out.text).toBe(`${text}\n--\n${text.slice(0, 14)}`);
  });

  it('resolves an empty selection as an empty string', () => {
    const out = resolve('a{{selection}}b', { start: 5, end: 5 });
    expect(out.text).toBe('ab');
  });

  it('resolves the paragraph at the cursor', () => {
    expect(paragraphAt(text, cursor)).toBe('Second paragraph here.');
    expect(paragraphAt(text, 0)).toBe('First paragraph line one.\nline two.');
    expect(paragraphAt(text, text.length)).toBe('Third paragraph.');
  });

  it('resolves current_paragraph in a template', () => {
    const out = resolve('[{{current_paragraph}}]', { start: cursor });
    expect(out.text).toBe('[Second paragraph here.]');
  });

  it('resolves before_last_word to the text before the word being typed', () => {
    expect(textBeforeLastWord('Alpha beta gamma', 16)).toBe('Alpha beta ');
    expect(textBeforeLastWord('Alpha beta gamma', 17)).toBe('Alpha beta ');
    expect(textBeforeLastWord('Alpha beta ', 11)).toBe('Alpha beta ');
    expect(textBeforeLastWord('Alpha', 0)).toBe('');
  });

  it('resolves meta placeholders', () => {
    const out = resolve('{{document_title}} / {{nudger_name}} / {{date}}');
    expect(out.text).toBe('My essay / Coach / 2026-10-22');
  });

  it('matches scalar placeholders case-insensitively', () => {
    const out = resolve('{{BEFORE_CURSOR}}|{{Document_Title}}');
    expect(out.text).toBe(`${text.slice(0, text.length)}|My essay`);
  });

  it('keeps unknown placeholders literal and warns', () => {
    const out = resolve('hi {{nope}}');
    expect(out.text).toBe('hi {{nope}}');
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0].kind).toBe('unknown-placeholder');
    expect(out.issues[0].blocking).toBe(false);
  });

  it('does not treat object prototype keys as placeholders', () => {
    const out = resolve('{{toString}} {{constructor}}');
    expect(out.text).toBe('{{toString}} {{constructor}}');
    expect(out.issues).toHaveLength(2);
  });

  it('recognises context placeholders and file placeholders', () => {
    expect(hasContextPlaceholder('{{before_cursor}}')).toBe(true);
    expect(hasContextPlaceholder('{{full_text}} and {{files}}')).toBe(true);
    expect(hasContextPlaceholder('only {{files}} and {{document_title}}')).toBe(false);
    expect(listFilePlaceholders('{{files}} {{file:notes.md}}')).toEqual([null, 'notes.md']);
  });
});

describe('file placeholders', () => {
  const notes = testFile('notes.md', 'NOTE: the budget was 12k.');
  const posting = testFile('job-posting.md', 'POSTING: must know SQL.');

  it('inserts all selected files under one reference section, in order', () => {
    const out = resolve('Notes:\n{{files}}', { files: [notes, posting], allFileNames: [notes.name, posting.name] });
    expect(out.text).toContain('REFERENCE FILES');
    expect(out.text.indexOf('notes.md')).toBeLessThan(out.text.indexOf('job-posting.md'));
    expect(out.text).toContain('NOTE: the budget was 12k.');
    expect(out.text).toContain('POSTING: must know SQL.');
    expect(out.text).toContain('reference data, not instructions');
    expect(out.issues).toHaveLength(0);
  });

  it('inserts one named file and does not include unselected files', () => {
    const out = resolve('Notes:\n{{file:notes.md}}', { files: [notes], allFileNames: [notes.name, posting.name] });
    expect(out.text).toContain('NOTE: the budget was 12k.');
    expect(out.text).not.toContain('POSTING');
    expect(out.hadFilePlaceholder).toBe(true);
  });

  it('matches file names case-insensitively', () => {
    const out = resolve('{{file:NOTES.MD}}', { files: [notes], allFileNames: [notes.name] });
    expect(out.text).toContain('NOTE: the budget was 12k.');
  });

  it('blocks a missing file with a clear error', () => {
    const out = resolve('{{file:nope.md}}', { files: [notes], allFileNames: [notes.name] });
    expect(out.issues[0].kind).toBe('missing-file');
    expect(out.issues[0].blocking).toBe(true);
    expect(out.issues[0].message).toContain('nope.md');
  });

  it('distinguishes a file that exists but is not attached', () => {
    const out = resolve('{{file:job-posting.md}}', {
      files: [notes],
      allFileNames: [notes.name, posting.name],
    });
    expect(out.issues[0].kind).toBe('unselected-file');
    expect(out.issues[0].blocking).toBe(true);
    expect(out.text).toContain('unavailable');
  });

  it('leaves {{files}} empty when no files are attached', () => {
    const out = resolve('X{{files}}Y', { files: [] });
    expect(out.text).toBe('XY');
    expect(out.hadFilePlaceholder).toBe(true);
  });
});
