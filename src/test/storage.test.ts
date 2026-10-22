import { afterEach, describe, expect, it } from 'vitest';
import { makeStore, newNudgerInput, testReplyInput } from './helpers';
import { DEFAULT_SETTINGS } from '../lib/defaults';
import { blankTemplate, STARTER_TEMPLATES } from '../lib/starters';

const active: Awaited<ReturnType<typeof makeStore>>[] = [];

async function freshStore() {
  const ctx = await makeStore();
  active.push(ctx);
  return ctx.store;
}

afterEach(async () => {
  while (active.length) {
    const ctx = active.pop();
    await ctx?.cleanup();
  }
});

describe('document storage', () => {
  it('creates, renames, and deletes documents with cascades', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('  My title  ', 'Body');
    expect(doc.title).toBe('My title');
    await store.renameDocument(doc.id, '   ');
    expect((await store.getDocument(doc.id))?.title).toBe('Untitled document');
    await store.createVersion(doc.id);
    const nudger = await store.createNudger(newNudgerInput());
    await store.addReply(testReplyInput(doc.id, nudger.id));
    await store.deleteDocument(doc.id);
    expect(await store.getDocument(doc.id)).toBeUndefined();
    expect(await store.listVersions(doc.id)).toHaveLength(0);
    expect(await store.listReplies(doc.id)).toHaveLength(0);
  });
});

describe('nudger storage', () => {
  it('creates, reorders, duplicates and deletes nudgers', async () => {
    const store = await freshStore();
    const a = await store.createNudger(newNudgerInput({ name: 'A' }));
    const b = await store.createNudger(newNudgerInput({ name: 'B' }));
    const c = await store.createNudger(newNudgerInput({ name: 'C' }));
    expect([a.order, b.order, c.order]).toEqual([0, 1, 2]);
    expect((await store.listNudgers()).map((n) => n.name)).toEqual(['A', 'B', 'C']);

    await store.moveNudger(c.id, -1);
    expect((await store.listNudgers()).map((n) => n.name)).toEqual(['A', 'C', 'B']);
    await store.moveNudger(a.id, -1);
    expect((await store.listNudgers()).map((n) => n.name)).toEqual(['A', 'C', 'B']);

    const copy = await store.duplicateNudger(a.id);
    expect(copy?.name).toBe('A (copy)');
    expect(copy?.autoRun).toBe(false);

    await store.addBudget(a.id, 3);
    expect((await store.getNudger(a.id))?.budget).toBe(6);

    const doc = await store.createDocument('Doc', 'Text');
    await store.addReply(testReplyInput(doc.id, a.id));
    await store.deleteNudger(a.id);
    expect(await store.getNudger(a.id)).toBeUndefined();
    expect(await store.listReplies(doc.id)).toHaveLength(0);
  });

  it('clamps provider parameters when they are updated', async () => {
    const store = await freshStore();
    const nudger = await store.createNudger(newNudgerInput());
    await store.updateNudger(nudger.id, { temperature: 9, maxTokens: 0, maxContextChars: 10 });
    const updated = await store.getNudger(nudger.id);
    expect(updated?.temperature).toBe(2);
    expect(updated?.maxTokens).toBe(1);
    expect(updated?.maxContextChars).toBe(1000);
  });

  it('removes a deleted file from every nudger that attached it', async () => {
    const store = await freshStore();
    const notes = await store.createFile('notes.md', 'facts');
    const other = await store.createFile('other.txt', 'other');
    const nudger = await store.createNudger(newNudgerInput({ fileIds: [notes.id, other.id] }));
    const affected = await store.deleteFile(notes.id);
    expect(affected).toEqual([nudger.name]);
    const updated = await store.getNudger(nudger.id);
    expect(updated?.fileIds).toEqual([other.id]);
    expect(await store.getFile(notes.id)).toBeUndefined();
  });
});

describe('reference file storage', () => {
  it('enforces unique names and validates extensions', async () => {
    const store = await freshStore();
    await store.createFile('notes.md', 'one');
    await expect(store.createFile('NOTES.md', 'two')).rejects.toThrow(/unique/i);
    await expect(store.createFile('cv.pdf', 'three')).rejects.toThrow(/txt and \.md/i);
    await expect(store.updateFile((await store.listFiles())[0].id, { name: 'cv.pdf' })).rejects.toThrow(
      /txt and \.md/i,
    );
    const renamed = await store.updateFile((await store.listFiles())[0].id, {
      name: 'notes-2.md',
      content: 'changed',
    });
    expect(renamed.name).toBe('notes-2.md');
    expect(renamed.wordCount).toBe(1);
  });
});

describe('replies', () => {
  it('stores replies, changes status, and clears history per nudger and document', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('Doc', 'Text');
    const otherDoc = await store.createDocument('Other', 'Text');
    const n1 = await store.createNudger(newNudgerInput({ name: 'One' }));
    const n2 = await store.createNudger(newNudgerInput({ name: 'Two' }));
    const reply = await store.addReply(testReplyInput(doc.id, n1.id));
    await store.addReply(testReplyInput(doc.id, n2.id));
    await store.addReply(testReplyInput(otherDoc.id, n1.id));
    expect(reply.status).toBe('new');
    await store.setReplyStatus(reply.id, 'pinned');
    expect((await store.listReplies(doc.id)).find((r) => r.id === reply.id)?.status).toBe('pinned');
    await store.clearReplyHistory(doc.id, n1.id);
    expect((await store.listReplies(doc.id)).map((r) => r.nudgerId)).toEqual([n2.id]);
    expect(await store.listReplies(otherDoc.id)).toHaveLength(1);

    await store.deleteNudger(n2.id);
    await expect(store.addReply(testReplyInput(doc.id, n2.id))).rejects.toThrow(/deleted/i);
  });
});

describe('settings', () => {
  it('defaults to DeepSeek and never stores the key', async () => {
    const store = await freshStore();
    const settings = await store.getSettings();
    expect(settings.providerId).toBe('deepseek');
    expect(settings.model).toBe('deepseek-flash');

    await store.setSettings({ ...DEFAULT_SETTINGS, apiKey: 'sk-super-secret', model: 'deepseek-v4-pro' });
    const row = await store.db.settings.get('app');
    expect(JSON.stringify(row)).not.toContain('sk-super-secret');
    expect(Object.hasOwn(row?.value ?? {}, 'apiKey')).toBe(false);
    expect((await store.getSettings()).model).toBe('deepseek-v4-pro');
  });
});

describe('templates', () => {
  it('keeps starters read-only and stores custom templates', async () => {
    const store = await freshStore();
    const starters = await store.listTemplates();
    expect(starters.length).toBeGreaterThanOrEqual(10);
    await expect(store.saveTemplate({ ...STARTER_TEMPLATES[0] })).rejects.toThrow(/read-only/i);
    await expect(store.deleteTemplate(STARTER_TEMPLATES[0].id)).rejects.toThrow(/read-only/i);

    const custom = blankTemplate();
    custom.name = 'Mine';
    const saved = await store.saveTemplate(custom);
    expect(saved.name).toBe('Mine');
    expect((await store.listTemplates()).some((t) => t.id === saved.id && !t.builtin)).toBe(true);
    await store.deleteTemplate(saved.id);
    expect((await store.listTemplates()).some((t) => t.id === saved.id)).toBe(false);
  });
});

describe('export and import', () => {
  it('exports everything except keys and restores it after a wipe', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('Doc', 'Hello');
    await store.createVersion(doc.id, 'v1');
    const file = await store.createFile('notes.md', 'attached fact');
    const nudger = await store.createNudger(
      newNudgerInput({
        fileIds: [file.id],
        facts: true,
        factsPrompt: 'Focus on the attached notes.',
      }),
    );
    await store.addReply({
      ...testReplyInput(doc.id, nudger.id),
      facts: ['1.2 million requests (notes.md)'],
    });
    await store.setSettings({ ...DEFAULT_SETTINGS, model: 'gpt-test', apiKey: 'sk-secret' });

    const bundle = await store.exportAll();
    expect(JSON.stringify(bundle)).not.toContain('sk-secret');
    expect(bundle.documents).toHaveLength(1);
    expect(bundle.files).toHaveLength(1);

    await store.clearAllData();
    expect(await store.listDocuments()).toHaveLength(0);
    expect((await store.getSettings()).model).toBe('deepseek-flash');

    const summary = await store.importBundle(bundle, 'replace');
    expect(summary).toMatchObject({
      documents: 1,
      versions: 1,
      files: 1,
      nudgers: 1,
      replies: 1,
      settingsRestored: true,
    });
    expect((await store.listDocuments())[0].currentText).toBe('Hello');
    expect((await store.listFiles())[0].content).toBe('attached fact');
    expect((await store.getNudger(nudger.id))?.facts).toBe(true);
    expect((await store.getNudger(nudger.id))?.factsPrompt).toBe('Focus on the attached notes.');
    expect((await store.listReplies(doc.id))[0].facts).toEqual(['1.2 million requests (notes.md)']);
    expect((await store.getSettings()).model).toBe('gpt-test');
  });

  it('does not trust a network endpoint from an import unless explicitly allowed', async () => {
    const store = await freshStore();
    await store.setSettings({
      ...DEFAULT_SETTINGS,
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
    });
    const bundle = await store.exportAll();
    bundle.settings = {
      ...bundle.settings,
      providerId: 'deepseek',
      baseUrl: 'https://attacker.example/v1',
      customHeaders: { 'X-Exfil': 'yes' },
      rememberKey: true,
    };

    await store.importBundle(bundle, 'replace');
    const safe = await store.getSettings();
    expect(safe.baseUrl).toBe('https://api.deepseek.com');
    expect(safe.customHeaders).toBeUndefined();
    expect(safe.rememberKey).toBe(false);

    await store.importBundle(bundle, 'replace', { restoreNetworkSettings: true });
    const restored = await store.getSettings();
    expect(restored.baseUrl).toBe('https://attacker.example/v1');
    expect(restored.customHeaders).toEqual({ 'X-Exfil': 'yes' });
    expect(restored.rememberKey).toBe(false);
  });

  it('remaps an imported file id to an existing file with the same name', async () => {
    const store = await freshStore();
    const existing = await store.createFile('notes.md', 'local facts');
    const bundle = await store.exportAll();
    bundle.files = [
      {
        id: 'imported-file-id',
        name: 'notes.md',
        kind: 'md',
        content: 'imported facts',
        createdAt: 1,
        updatedAt: 1,
        wordCount: 2,
      },
    ];
    bundle.nudgers = [
      {
        id: 'imported-nudger',
        name: 'Imported coach',
        color: '#7aa2f7',
        system: '',
        prompt: 'Notes:\n{{file:notes.md}}',
        fileIds: ['imported-file-id'],
        temperature: 0.4,
        maxTokens: 700,
        maxContextChars: 100000,
        autoRun: false,
        enabled: true,
        done: false,
        budget: 3,
        facts: false,
        factsPrompt: 'Focus on concrete specifics the writer should verify.',
        order: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const summary = await store.importBundle(bundle, 'merge');
    expect(summary.files).toBe(0);
    expect(summary.nudgers).toBe(1);
    const imported = (await store.listNudgers()).find((n) => n.id === 'imported-nudger');
    expect(imported?.fileIds).toEqual([existing.id]);
    expect((await store.getFile(existing.id))?.content).toBe('local facts');
  });

  it('merges by id without overwriting current work or settings', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('Original', 'Mine');
    const bundle = await store.exportAll();
    await store.renameDocument(doc.id, 'Renamed locally');
    await store.setSettings({ ...DEFAULT_SETTINGS, model: 'kept-model' });

    const merging = structuredClone(bundle);
    merging.documents.push({
      id: 'new-doc',
      title: 'Imported',
      currentText: 'Imported text',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    merging.files.push({
      id: 'new-file',
      name: 'imported.txt',
      kind: 'txt',
      content: 'imported file',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      wordCount: 2,
    });
    const summary = await store.importBundle(merging, 'merge');
    expect(summary.documents).toBe(1);
    expect(summary.files).toBe(1);
    expect(summary.settingsRestored).toBe(false);
    const docs = await store.listDocuments();
    expect(docs).toHaveLength(2);
    expect(docs.find((d) => d.id === doc.id)?.title).toBe('Renamed locally');
    expect((await store.getSettings()).model).toBe('kept-model');
  });
});

describe('storage helpers', () => {
  it('reports version counts and clears all data', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('Doc', 'Text');
    await store.createVersion(doc.id);
    await store.createVersion(doc.id);
    expect(await store.listVersionCounts()).toEqual({ [doc.id]: 2 });
    await store.clearAllData();
    expect(await store.listVersions(doc.id)).toHaveLength(0);
    expect(await store.listNudgers()).toHaveLength(0);
    expect(await store.listCustomTemplates()).toHaveLength(0);
  });
});
