import { describe, expect, it } from 'vitest';
import { prepareRun, REPLY_LENGTH_RULE, SELECTION_SCOPE_RULE } from '../lib/run';
import { selectionScope } from '../lib/scope';
import { testNudger, testSettings } from './helpers';

const draft = 'First paragraph about the intro.\n\nSecond paragraph, the part I selected.\n\nClosing line.';
const selectionStart = draft.indexOf('Second paragraph');
const selectionEnd = draft.indexOf('\n\nClosing');

describe('selection scope', () => {
  it('ignores an empty or whitespace-only selection', () => {
    expect(selectionScope(draft, { start: 4, end: 4 })).toBeNull();
    const blankAt = draft.indexOf('\n\n');
    expect(selectionScope(draft, { start: blankAt, end: blankAt + 2 })).toBeNull();
  });

  it('returns the selected passage with the cursor at its end', () => {
    const scope = selectionScope(draft, { start: selectionStart, end: selectionEnd });
    expect(scope?.text).toBe('Second paragraph, the part I selected.');
    expect(scope?.caret).toEqual({
      start: 'Second paragraph, the part I selected.'.length,
      end: 'Second paragraph, the part I selected.'.length,
    });
    expect(scope?.words).toBe(6);
  });

  it('treats a backwards selection the same way', () => {
    const forwards = selectionScope(draft, { start: selectionStart, end: selectionEnd });
    const backwards = selectionScope(draft, { start: selectionEnd, end: selectionStart });
    expect(backwards).toEqual(forwards);
  });

  it('clamps a stale selection to the current text length', () => {
    const scope = selectionScope('short', { start: 2, end: 900 });
    expect(scope?.text).toBe('ort');
    expect(scope?.caret).toEqual({ start: 3, end: 3 });
  });
});

describe('a run scoped to the selection', () => {
  const scope = selectionScope(draft, { start: selectionStart, end: selectionEnd })!;

  function preparedFor(prompt: string, scoped: boolean) {
    return prepareRun({
      nudger: testNudger({ documentId: 'doc-1', prompt }),
      document: {
        id: 'doc-1',
        title: 'Draft',
        currentText: scoped ? scope.text : draft,
      },
      caret: scoped ? scope.caret : { start: selectionStart, end: selectionEnd },
      files: [],
      settings: testSettings,
      selectionScoped: scoped,
    });
  }

  it('sends only the passage and says so in the system prompt', () => {
    const prepared = preparedFor('Draft:\n{{before_cursor}}', true);
    expect(prepared.prompt).toBe('Draft:\nSecond paragraph, the part I selected.');
    expect(prepared.system).toContain(SELECTION_SCOPE_RULE);
    expect(prepared.selectionScoped).toBe(true);
    expect(prepared.prompt).not.toContain('First paragraph');
    expect(prepared.prompt).not.toContain('Closing line');
  });

  it('keeps the passage in the length rule order and above the scope rule', () => {
    const prepared = preparedFor('Draft:\n{{before_cursor}}', true);
    expect(prepared.system.indexOf(REPLY_LENGTH_RULE)).toBeLessThan(
      prepared.system.indexOf(SELECTION_SCOPE_RULE),
    );
  });

  it('reads the other context placeholders from the passage', () => {
    const prepared = preparedFor(
      '{{selection}}\n---\n{{full_text}}\n---\n{{after_cursor}}\n---\n{{current_paragraph}}',
      true,
    );
    const parts = prepared.prompt.split('---');
    expect(parts[0].trim()).toBe('Second paragraph, the part I selected.');
    expect(parts[1].trim()).toBe('Second paragraph, the part I selected.');
    expect(parts[2].trim()).toBe('');
    expect(parts[3].trim()).toBe('Second paragraph, the part I selected.');
  });

  it('leaves an unscoped run on the whole draft', () => {
    const prepared = preparedFor('Draft:\n{{before_cursor}}', false);
    expect(prepared.selectionScoped).toBe(false);
    expect(prepared.system).not.toContain(SELECTION_SCOPE_RULE);
    expect(prepared.prompt).toContain('First paragraph about the intro.');
    expect(prepared.prompt).not.toContain('Closing line');
  });

  it('keeps the scope rule when an oversized scoped prompt is trimmed', () => {
    const long = selectionScope('x'.repeat(3000), { start: 0, end: 3000 })!;
    const prepared = prepareRun({
      nudger: testNudger({ documentId: 'doc-1', maxContextChars: 1200 }),
      document: { id: 'doc-1', title: 'Draft', currentText: long.text },
      caret: long.caret,
      files: [],
      settings: testSettings,
      trimToLimit: true,
      selectionScoped: true,
      avoid: ['Name the request count.'],
    });
    expect(prepared.trimmed).toBe(true);
    expect(prepared.system).toContain(SELECTION_SCOPE_RULE);
    expect(prepared.system).toContain('REJECTED NUDGES');
  });
});
