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
    const nudger = await store.createNudger(newNudgerInput({ documentId: doc.id }));
    await store.addReply(testReplyInput(doc.id, nudger.id));
    await store.deleteDocument(doc.id);
    expect(await store.getDocument(doc.id)).toBeUndefined();
    expect(await store.listVersions(doc.id)).toHaveLength(0);
    expect(await store.listReplies(doc.id)).toHaveLength(0);
    expect(await store.getNudger(nudger.id)).toBeUndefined();
  });
});

describe('nudger storage', () => {
  it('creates, reorders, duplicates and deletes nudgers', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('Doc', 'Text');
    const a = await store.createNudger(newNudgerInput({ documentId: doc.id, name: 'A', autoRun: true }));
    const b = await store.createNudger(newNudgerInput({ documentId: doc.id, name: 'B' }));
    const c = await store.createNudger(newNudgerInput({ documentId: doc.id, name: 'C' }));
    expect([a.order, b.order, c.order]).toEqual([0, 1, 2]);
    expect((await store.listNudgers(doc.id)).map((n) => n.name)).toEqual(['A', 'B', 'C']);

    await store.moveNudger(c.id, -1);
    expect((await store.listNudgers(doc.id)).map((n) => n.name)).toEqual(['A', 'C', 'B']);
    await store.moveNudger(a.id, -1);
    expect((await store.listNudgers(doc.id)).map((n) => n.name)).toEqual(['A', 'C', 'B']);

    const copy = await store.duplicateNudger(a.id);
    expect(copy?.name).toBe('A (copy)');
    expect(copy?.autoRun).toBe(true);
    expect(copy?.documentId).toBe(doc.id);
    expect(copy?.order).toBe(3);

    await store.addReply(testReplyInput(doc.id, a.id));
    await store.deleteNudger(a.id);
    expect(await store.getNudger(a.id)).toBeUndefined();
    expect(await store.listReplies(doc.id)).toHaveLength(0);
  });

  it('clamps provider parameters when they are updated', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('Doc', 'Text');
    const nudger = await store.createNudger(newNudgerInput({ documentId: doc.id }));
    await store.updateNudger(nudger.id, { temperature: 9, maxTokens: 0, maxContextChars: 10 });
    const updated = await store.getNudger(nudger.id);
    expect(updated?.temperature).toBe(2);
    expect(updated?.maxTokens).toBe(1);
    expect(updated?.maxContextChars).toBe(1000);
  });

  it('removes a deleted file from the nudger that owns it', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('Doc', 'Text');
    const nudger = await store.createNudger(newNudgerInput({ documentId: doc.id }));
    const notes = await store.createFile(nudger.id, 'notes.md', 'facts');
    const other = await store.createFile(nudger.id, 'other.txt', 'other');
    expect((await store.getNudger(nudger.id))?.fileIds).toEqual([notes.id, other.id]);

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
    const doc = await store.createDocument('Doc', 'Text');
    const nudger = await store.createNudger(newNudgerInput({ documentId: doc.id }));
    await store.createFile(nudger.id, 'notes.md', 'one');
    await expect(store.createFile(nudger.id, 'NOTES.md', 'two')).rejects.toThrow(/unique/i);
    await expect(store.createFile(nudger.id, 'cv.pdf', 'three')).rejects.toThrow(/txt and \.md/i);
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

  it('gives every nudger its own file list', async () => {
    const store = await freshStore();
    const first = await store.createDocument('First', 'Text');
    const second = await store.createDocument('Second', 'Text');
    const firstNudger = await store.createNudger(newNudgerInput({ documentId: first.id, name: 'A' }));
    const secondNudger = await store.createNudger(newNudgerInput({ documentId: second.id, name: 'B' }));
    const firstNotes = await store.createFile(firstNudger.id, 'notes.md', 'first facts');
    const secondNotes = await store.createFile(secondNudger.id, 'notes.md', 'second facts');

    expect(firstNotes.id).not.toBe(secondNotes.id);
    expect(firstNotes.nudgerId).toBe(firstNudger.id);
    expect((await store.listFilesForNudger(firstNudger.id)).map((file) => file.content)).toEqual([
      'first facts',
    ]);
    expect((await store.listFilesForNudger(secondNudger.id)).map((file) => file.content)).toEqual([
      'second facts',
    ]);
    expect(await store.listFiles()).toHaveLength(2);

    await expect(store.createFile(secondNudger.id, 'NOTES.MD', 'third')).rejects.toThrow(/unique/i);
    await expect(store.createFile('missing-nudger', 'notes.md', 'x')).rejects.toThrow(
      /choose a nudger/i,
    );
  });

  it('deletes a document with its files and copies them on duplicate', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('Source', 'Text');
    const nudger = await store.createNudger(newNudgerInput({ documentId: doc.id }));
    const notes = await store.createFile(nudger.id, 'notes.md', 'facts');

    const copy = await store.duplicateDocument(doc.id);
    expect(copy).not.toBeNull();
    const copiedFiles = await store.listFiles(copy!.id);
    expect(copiedFiles).toHaveLength(1);
    expect(copiedFiles[0].id).not.toBe(notes.id);
    expect(copiedFiles[0].content).toBe('facts');
    const copiedNudger = (await store.listNudgers(copy!.id))[0];
    expect(copiedNudger.fileIds).toEqual([copiedFiles[0].id]);
    expect((await store.getNudger(nudger.id))?.fileIds).toEqual([notes.id]);

    await store.deleteDocument(doc.id);
    expect(await store.getFile(notes.id)).toBeUndefined();
    expect(await store.listFiles(copy!.id)).toHaveLength(1);
  });
});

describe('replies', () => {
  it('stores replies, changes status, and clears history per nudger and document', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('Doc', 'Text');
    const otherDoc = await store.createDocument('Other', 'Text');
    const n1 = await store.createNudger(newNudgerInput({ documentId: doc.id, name: 'One' }));
    const n2 = await store.createNudger(newNudgerInput({ documentId: doc.id, name: 'Two' }));
    const other = await store.createNudger(
      newNudgerInput({ documentId: otherDoc.id, name: 'Other' }),
    );
    const reply = await store.addReply(testReplyInput(doc.id, n1.id));
    await store.addReply(testReplyInput(doc.id, n2.id));
    await store.addReply(testReplyInput(otherDoc.id, other.id));
    await expect(store.addReply(testReplyInput(otherDoc.id, n1.id))).rejects.toThrow(
      /different document/i,
    );
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
    const nudger = await store.createNudger(
      newNudgerInput({
        documentId: doc.id,
        facts: true,
        factsPrompt: 'Focus on the attached notes.',
      }),
    );
    await store.createFile(nudger.id, 'notes.md', 'attached fact');
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

  it('keeps same-named files of different nudgers apart on import', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('Imported target', 'Text');
    const localNudger = await store.createNudger(
      newNudgerInput({ documentId: doc.id, name: 'Local coach' }),
    );
    const existing = await store.createFile(localNudger.id, 'notes.md', 'local facts');
    const bundle = await store.exportAll();
    bundle.files = [
      {
        id: 'imported-file-id',
        documentId: doc.id,
        nudgerId: 'imported-nudger',
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
        documentId: doc.id,
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
    expect(summary.files).toBe(1);
    expect(summary.nudgers).toBe(1);
    const imported = (await store.listNudgers(doc.id)).find((n) => n.id === 'imported-nudger');
    expect(imported?.fileIds).toEqual(['imported-file-id']);
    expect((await store.getFile(existing.id))?.content).toBe('local facts');
    expect((await store.getFile('imported-file-id'))?.content).toBe('imported facts');
  });

  it('reuses an existing file of the same nudger by name on import', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('Target', 'Text');
    const nudger = await store.createNudger(newNudgerInput({ documentId: doc.id }));
    const existing = await store.createFile(nudger.id, 'notes.md', 'local facts');
    const bundle = await store.exportAll();
    bundle.files = [
      {
        id: 'duplicate-id',
        documentId: doc.id,
        nudgerId: nudger.id,
        name: 'NOTES.md',
        kind: 'md',
        content: 'imported facts',
        createdAt: 1,
        updatedAt: 1,
        wordCount: 2,
      },
    ];
    const summary = await store.importBundle(bundle, 'merge');
    expect(summary.files).toBe(0);
    expect(await store.listFilesForNudger(nudger.id)).toHaveLength(1);
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
      documentId: 'new-doc',
      nudgerId: null,
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
