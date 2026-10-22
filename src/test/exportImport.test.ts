import { describe, expect, it } from 'vitest';
import { validateBundle, exportFileName } from '../lib/exportImport';
import { DEFAULT_SETTINGS } from '../lib/defaults';
import type { ExportedBundle } from '../types';

function baseBundle(): ExportedBundle {
  const now = Date.now();
  return {
    app: 'nudger',
    schemaVersion: 2,
    exportedAt: now,
    documents: [{ id: 'd1', title: 'Doc', currentText: 'Text', createdAt: now, updatedAt: now }],
    versions: [
      { id: 'v1', documentId: 'd1', text: 'Old', createdAt: now, wordCount: 1, label: 'first' },
    ],
    files: [
      {
        id: 'f1',
        name: 'notes.md',
        kind: 'md',
        content: 'facts',
        createdAt: now,
        updatedAt: now,
        wordCount: 1,
      },
    ],
    nudgers: [
      {
        id: 'n1',
        documentId: 'd1',
        name: 'Coach',
        color: '#7aa2f7',
        system: 'Be brief',
        prompt: 'Draft:\n{{before_cursor}}',
        fileIds: ['f1'],
        temperature: 0.4,
        maxTokens: 700,
        maxContextChars: 100000,
        autoRun: false,
        enabled: true,
        done: false,
        budget: 3,
        facts: true,
        factsPrompt: 'Focus on the notes.',
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
    replies: [
      {
        id: 'r1',
        documentId: 'd1',
        nudgerId: 'n1',
        text: 'A nudge',
        resolvedPrompt: '=== USER ===\nDraft',
        fileIds: ['f1'],
        model: 'deepseek-flash',
        provider: 'deepseek',
        createdAt: now,
        status: 'new',
        facts: ['400 tickets a week'],
      },
    ],
    templates: [
      {
        id: 't1',
        name: 'Mine',
        description: '',
        system: '',
        prompt: 'Draft:\n{{before_cursor}}',
        temperature: 0.3,
        maxTokens: 900,
        maxContextChars: 50_000,
        builtin: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    settings: { ...DEFAULT_SETTINGS },
  };
}

describe('export validation', () => {
  it('accepts a complete bundle and strips any key from settings', () => {
    const bundle = baseBundle();
    (bundle.settings as { apiKey?: string }).apiKey = 'sk-should-not-import';
    const result = validateBundle(bundle);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.documents).toHaveLength(1);
    expect(result.bundle.versions).toHaveLength(1);
    expect(result.bundle.nudgers[0].fileIds).toEqual(['f1']);
    expect(result.bundle.replies[0].status).toBe('new');
    expect(result.bundle.nudgers[0].facts).toBe(true);
    expect(result.bundle.nudgers[0].factsPrompt).toBe('Focus on the notes.');
    expect(result.bundle.replies[0].facts).toEqual(['400 tickets a week']);
    expect(JSON.stringify(result.bundle.settings)).not.toContain('sk-should-not-import');
  });

  it('rejects a file from another app or an unknown version', () => {
    expect(validateBundle({ app: 'other' }).ok).toBe(false);
    expect(validateBundle({ ...baseBundle(), schemaVersion: 3 }).ok).toBe(false);
    expect(validateBundle('not json').ok).toBe(false);
  });

  it('keeps document-bound nudgers on their document and carries template settings', () => {
    const result = validateBundle(baseBundle());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.nudgers).toHaveLength(1);
    expect(result.bundle.nudgers[0].documentId).toBe('d1');
    expect(result.bundle.templates[0]).toMatchObject({
      temperature: 0.3,
      maxTokens: 900,
      maxContextChars: 50_000,
    });
  });

  it('copies global nudgers from a version 1 export into every document', () => {
    const legacy = baseBundle();
    legacy.schemaVersion = 1;
    legacy.documents.push({
      id: 'd2',
      title: 'Second',
      currentText: 'Other text',
      createdAt: Date.now() + 1,
      updatedAt: Date.now() + 1,
    });
    delete (legacy.nudgers[0] as { documentId?: string }).documentId;
    legacy.replies[0].documentId = 'd2';

    const result = validateBundle(legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.nudgers).toHaveLength(2);
    const byDocument = new Map(result.bundle.nudgers.map((n) => [n.documentId, n.id]));
    expect([...byDocument.keys()].sort()).toEqual(['d1', 'd2']);
    expect(result.bundle.replies).toHaveLength(1);
    expect(result.bundle.replies[0].nudgerId).toBe(byDocument.get('d2'));
    expect(result.warnings.some((w) => w.includes('older export'))).toBe(true);
  });

  it('skips a global nudger when a version 1 export has no document', () => {
    const legacy = baseBundle();
    legacy.schemaVersion = 1;
    legacy.documents = [];
    legacy.replies = [];
    legacy.versions = [];
    delete (legacy.nudgers[0] as { documentId?: string }).documentId;
    const result = validateBundle(legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.nudgers).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('no document to attach'))).toBe(true);
  });

  it('drops invalid files and dangling references with warnings', () => {
    const bundle = baseBundle();
    bundle.files.push({
      id: 'f2',
      name: 'cv.pdf',
      kind: 'txt',
      content: 'nope',
      createdAt: 1,
      updatedAt: 1,
      wordCount: 1,
    });
    bundle.nudgers[0].fileIds = ['f1', 'missing-file'];
    bundle.nudgers[0].autoRun = true;
    bundle.nudgers[0].providerId = 'openai';
    bundle.nudgers[0].budget = 99_999;
    bundle.replies.push({
      ...bundle.replies[0],
      id: 'r2',
      documentId: 'missing-doc',
    });
    const result = validateBundle(bundle);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.files).toHaveLength(1);
    expect(result.bundle.nudgers[0].fileIds).toEqual(['f1']);
    expect(result.bundle.nudgers[0].autoRun).toBe(false);
    expect(result.bundle.nudgers[0].providerId).toBeUndefined();
    expect(result.bundle.nudgers[0].budget).toBe(10_000);
    expect(result.bundle.replies).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes('cv.pdf'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('not in the export'))).toBe(true);
  });

  it('recomputes word counts and keeps normalized settings', () => {
    const bundle = baseBundle();
    bundle.versions[0].wordCount = 999;
    bundle.settings = { ...bundle.settings, providerId: 'deepseek', model: 'deepseek-v4-pro' };
    const result = validateBundle(bundle);
    if (!result.ok) throw new Error('expected ok');
    expect(result.bundle.versions[0].wordCount).toBe(1);
    expect(result.bundle.settings.model).toBe('deepseek-v4-pro');
    expect(result.bundle.settings.providerId).toBe('deepseek');
  });

  it('names exports with a timestamp', () => {
    expect(exportFileName(new Date('2026-10-22T14:05:00Z'))).toMatch(
      /^nudger-export-2026-10-22-\d{4}\.json$/,
    );
  });
});
