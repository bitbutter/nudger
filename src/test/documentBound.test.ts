import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { NudgerDB } from '../lib/db';
import { planFileMigration, planNudgerMigration } from '../lib/migrate';
import { getTemplateById, nudgerFromTemplate, templateFromNudger } from '../lib/starters';
import { DEFAULT_SETTINGS } from '../lib/defaults';
import { makeStore, newNudgerInput, testNudger } from './helpers';

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

function legacyNudger(overrides: Partial<ReturnType<typeof testNudger>> = {}) {
  const { documentId: _documentId, ...rest } = testNudger(overrides);
  void _documentId;
  return rest;
}

describe('nudger migration planning', () => {
  it('copies each global nudger into every document and rewires replies', () => {
    const docs = [
      { id: 'a', title: 'A', createdAt: 1 },
      { id: 'b', title: 'B', createdAt: 2 },
    ];
    const global = legacyNudger({ name: 'Coach' });
    const replies = [
      { id: 'ra', documentId: 'a', nudgerId: global.id },
      { id: 'rb', documentId: 'b', nudgerId: global.id },
      { id: 'rx', documentId: 'missing', nudgerId: global.id },
    ];
    const plan = planNudgerMigration(docs, [global], replies);

    expect(plan.nudgers).toHaveLength(2);
    const copyA = plan.nudgers.find((n) => n.documentId === 'a')!;
    const copyB = plan.nudgers.find((n) => n.documentId === 'b')!;
    expect(copyA.id).not.toBe(copyB.id);
    expect(copyA.name).toBe('Coach');
    expect(copyA.createdAt).toBe(global.createdAt);
    expect(plan.replyUpdates).toEqual([
      { id: 'ra', nudgerId: copyA.id },
      { id: 'rb', nudgerId: copyB.id },
    ]);
  });

  it('leaves already document-bound nudgers alone', () => {
    const docs = [{ id: 'a', title: 'A', createdAt: 1 }];
    const bound = testNudger({ documentId: 'a' });
    const plan = planNudgerMigration(docs, [bound], []);
    expect(plan.nudgers.map((n) => n.id)).toEqual([bound.id]);
    expect(plan.replyUpdates).toHaveLength(0);
  });

  it('keeps the configuration as templates when there is no document', () => {
    const plan = planNudgerMigration([], [legacyNudger({ name: 'Coach' })], []);
    expect(plan.nudgers).toHaveLength(0);
    expect(plan.templates).toHaveLength(1);
    expect(plan.templates[0].name).toBe('Coach template');
    expect(plan.templates[0].prompt).toContain('{{before_cursor}}');
  });
});

describe('database upgrade to document-bound nudgers', () => {
  it('migrates a version 1 database in place', async () => {
    const name = `nudger-v1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      documents: 'id, title, createdAt, updatedAt',
      versions: 'id, documentId, createdAt',
      files: 'id, name, createdAt, updatedAt',
      nudgers: 'id, order, createdAt',
      replies: 'id, documentId, nudgerId, createdAt, [documentId+nudgerId]',
      templates: 'id, createdAt',
      settings: 'key',
    });
    await legacy.open();
    const now = Date.now();
    await legacy.table('documents').bulkAdd([
      { id: 'a', title: 'A', currentText: 'A text', createdAt: now, updatedAt: now },
      { id: 'b', title: 'B', currentText: 'B text', createdAt: now + 1, updatedAt: now + 1 },
    ]);
    const global = legacyNudger({ name: 'Coach' });
    await legacy.table('nudgers').add(global);
    await legacy.table('replies').bulkAdd([
      {
        id: 'ra',
        documentId: 'a',
        nudgerId: global.id,
        text: 'nudge a',
        resolvedPrompt: '',
        fileIds: [],
        model: 'm',
        provider: 'deepseek',
        createdAt: now,
        status: 'new',
      },
      {
        id: 'rb',
        documentId: 'b',
        nudgerId: global.id,
        text: 'nudge b',
        resolvedPrompt: '',
        fileIds: [],
        model: 'm',
        provider: 'deepseek',
        createdAt: now,
        status: 'new',
      },
    ]);
    legacy.close();

    const upgraded = new NudgerDB(name);
    try {
      await upgraded.open();
      const copies = await upgraded.nudgers.toArray();
      expect(copies).toHaveLength(2);
      const byDocument = new Map(copies.map((n) => [n.documentId, n.id]));
      expect(byDocument.get('a')).toBeTruthy();
      expect(byDocument.get('b')).toBeTruthy();
      expect(byDocument.get('a')).not.toBe(byDocument.get('b'));
      const replyA = await upgraded.replies.get('ra');
      const replyB = await upgraded.replies.get('rb');
      expect(replyA?.nudgerId).toBe(byDocument.get('a'));
      expect(replyB?.nudgerId).toBe(byDocument.get('b'));
      expect(await upgraded.nudgers.where('documentId').equals('a').count()).toBe(1);
      expect(await upgraded.nudgers.where('documentId').equals('b').count()).toBe(1);
      expect(await upgraded.nudgers.get(global.id)).toBeUndefined();
    } finally {
      upgraded.close();
      await Dexie.delete(name);
    }
  });
});

function legacyFile(name = 'notes.md', content = 'facts') {
  return {
    id: `file-${name}`,
    name,
    kind: 'md' as const,
    content,
    createdAt: 1,
    updatedAt: 1,
    wordCount: 1,
  };
}

describe('reference file migration planning', () => {
  it('copies a shared library file into every document and rewires nudgers and replies', () => {
    const docs = [
      { id: 'a', title: 'A', createdAt: 1 },
      { id: 'b', title: 'B', createdAt: 2 },
    ];
    const file = legacyFile();
    const nudgers = [
      { id: 'na', documentId: 'a', fileIds: [file.id] },
      { id: 'nb', documentId: 'b', fileIds: [file.id, 'gone'] },
    ];
    const replies = [{ id: 'ra', documentId: 'a', fileIds: [file.id] }];
    const plan = planFileMigration(docs, [file], nudgers, replies);

    expect(plan.files).toHaveLength(2);
    const copyA = plan.files.find((f) => f.documentId === 'a')!;
    const copyB = plan.files.find((f) => f.documentId === 'b')!;
    expect(copyA.id).not.toBe(copyB.id);
    expect(copyA.name).toBe('notes.md');
    expect(copyA.content).toBe('facts');
    expect(plan.nudgerUpdates).toEqual([
      { id: 'na', fileIds: [copyA.id] },
      { id: 'nb', fileIds: [copyB.id] },
    ]);
    expect(plan.replyUpdates).toEqual([{ id: 'ra', fileIds: [copyA.id] }]);
  });

  it('leaves document-bound files alone', () => {
    const docs = [{ id: 'a', title: 'A', createdAt: 1 }];
    const scoped = { ...legacyFile(), documentId: 'a' };
    const plan = planFileMigration(docs, [scoped], [{ id: 'na', documentId: 'a', fileIds: [scoped.id] }], []);
    expect(plan.files.map((f) => f.id)).toEqual([scoped.id]);
    expect(plan.nudgerUpdates).toHaveLength(0);
  });

  it('drops a shared library file when there is no document to own it', () => {
    const plan = planFileMigration([], [legacyFile()], [], []);
    expect(plan.files).toHaveLength(0);
    expect(plan.nudgerUpdates).toHaveLength(0);
  });
});

describe('database upgrade to document-bound files', () => {
  it('migrates a version 2 database in place', async () => {
    const name = `nudger-v2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const legacy = new Dexie(name);
    legacy.version(2).stores({
      documents: 'id, title, createdAt, updatedAt',
      versions: 'id, documentId, createdAt',
      files: 'id, name, createdAt, updatedAt',
      nudgers: 'id, documentId, order, createdAt',
      replies: 'id, documentId, nudgerId, createdAt, [documentId+nudgerId]',
      templates: 'id, createdAt',
      settings: 'key',
    });
    await legacy.open();
    const now = Date.now();
    await legacy.table('documents').bulkAdd([
      { id: 'a', title: 'A', currentText: 'A text', createdAt: now, updatedAt: now },
      { id: 'b', title: 'B', currentText: 'B text', createdAt: now + 1, updatedAt: now + 1 },
    ]);
    await legacy.table('files').add(legacyFile('shared.md', 'shared facts'));
    await legacy.table('nudgers').bulkAdd([
      { ...testNudger({ documentId: 'a' }), id: 'na', fileIds: ['file-shared.md'] },
      { ...testNudger({ documentId: 'b' }), id: 'nb', fileIds: ['file-shared.md'] },
    ]);
    await legacy.table('replies').add({
      id: 'ra',
      documentId: 'a',
      nudgerId: 'na',
      text: 'nudge a',
      resolvedPrompt: '',
      fileIds: ['file-shared.md'],
      model: 'm',
      provider: 'deepseek',
      createdAt: now,
      status: 'new',
    });
    legacy.close();

    const upgraded = new NudgerDB(name);
    try {
      await upgraded.open();
      const files = await upgraded.files.toArray();
      expect(files).toHaveLength(2);
      const byDocument = new Map(files.map((file) => [file.documentId, file.id]));
      expect(byDocument.get('a')).toBeTruthy();
      expect(byDocument.get('b')).toBeTruthy();
      expect(byDocument.get('a')).not.toBe(byDocument.get('b'));
      expect((await upgraded.nudgers.get('na'))?.fileIds).toEqual([byDocument.get('a')]);
      expect((await upgraded.nudgers.get('nb'))?.fileIds).toEqual([byDocument.get('b')]);
      expect((await upgraded.replies.get('ra'))?.fileIds).toEqual([byDocument.get('a')]);
      expect(await upgraded.files.get('file-shared.md')).toBeUndefined();
    } finally {
      upgraded.close();
      await Dexie.delete(name);
    }
  });
});

describe('document-bound nudger storage', () => {
  it('keeps board order and listing per document', async () => {
    const store = await freshStore();
    const first = await store.createDocument('First', 'Text');
    const second = await store.createDocument('Second', 'Text');
    const a = await store.createNudger(newNudgerInput({ documentId: first.id, name: 'A' }));
    const b = await store.createNudger(newNudgerInput({ documentId: second.id, name: 'B' }));
    expect(a.order).toBe(0);
    expect(b.order).toBe(0);
    expect((await store.listNudgers(first.id)).map((n) => n.name)).toEqual(['A']);
    expect((await store.listNudgers(second.id)).map((n) => n.name)).toEqual(['B']);
    expect(await store.listNudgers()).toHaveLength(2);
  });

  it('never lets an update move a nudger to another document', async () => {
    const store = await freshStore();
    const first = await store.createDocument('First', 'Text');
    const second = await store.createDocument('Second', 'Text');
    const nudger = await store.createNudger(newNudgerInput({ documentId: first.id, name: 'A' }));
    await store.updateNudger(nudger.id, { documentId: second.id, prompt: 'Changed' });
    const after = await store.getNudger(nudger.id);
    expect(after?.documentId).toBe(first.id);
    expect(after?.prompt).toBe('Changed');
  });

  it('refuses to create a nudger without its document', async () => {
    const store = await freshStore();
    await expect(
      store.createNudger(newNudgerInput({ documentId: 'missing-document' })),
    ).rejects.toThrow(/no longer exists/i);
  });

  it('copies the nudger setup with a duplicated document but not its replies', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('Source', 'Text');
    const nudger = await store.createNudger(
      newNudgerInput({ documentId: doc.id, name: 'Coach', budget: 7, facts: true }),
    );
    await store.addReply({
      documentId: doc.id,
      nudgerId: nudger.id,
      text: 'nudge',
      resolvedPrompt: '',
      fileIds: [],
      model: 'm',
      provider: 'deepseek',
    });

    const copy = await store.duplicateDocument(doc.id);
    expect(copy).not.toBeNull();
    const copied = await store.listNudgers(copy!.id);
    expect(copied).toHaveLength(1);
    expect(copied[0].id).not.toBe(nudger.id);
    expect(copied[0].name).toBe('Coach');
    expect(copied[0].budget).toBe(7);
    expect(copied[0].facts).toBe(true);
    expect(copied[0].autoRun).toBe(false);
    expect(await store.listReplies(copy!.id)).toHaveLength(0);
    expect(await store.listReplies(doc.id)).toHaveLength(1);
  });

  it('deletes only the deleted document nudgers and replies', async () => {
    const store = await freshStore();
    const keep = await store.createDocument('Keep', 'Text');
    const drop = await store.createDocument('Drop', 'Text');
    const kept = await store.createNudger(newNudgerInput({ documentId: keep.id, name: 'Kept' }));
    const dropped = await store.createNudger(newNudgerInput({ documentId: drop.id, name: 'Dropped' }));

    await store.deleteDocument(drop.id);
    expect(await store.getNudger(dropped.id)).toBeUndefined();
    expect(await store.getNudger(kept.id)).toBeDefined();
    expect(await store.listNudgers(keep.id)).toHaveLength(1);
  });
});

describe('nudger to template', () => {
  it('keeps placeholders and generation settings but not files or the document', () => {
    const nudger = testNudger({
      name: 'Coach',
      system: 'System {{document_title}}',
      prompt: 'Notes:\n{{files}}\n\nDraft:\n{{before_cursor}}',
      facts: true,
      factsPrompt: 'Focus on the notes.',
      temperature: 0.7,
      maxTokens: 900,
      maxContextChars: 50_000,
    });
    const template = templateFromNudger(nudger, { id: 'tpl', now: 123 });

    expect(template).toMatchObject({
      id: 'tpl',
      name: 'Coach template',
      system: nudger.system,
      prompt: nudger.prompt,
      facts: true,
      factsPrompt: 'Focus on the notes.',
      temperature: 0.7,
      maxTokens: 900,
      maxContextChars: 50_000,
      builtin: false,
      createdAt: 123,
    });
    expect(JSON.stringify(template)).not.toContain('documentId');
    expect(JSON.stringify(template)).not.toContain('fileIds');

    const other = nudgerFromTemplate(template, {
      documentId: 'other-doc',
      order: 0,
      settings: DEFAULT_SETTINGS,
    });
    expect(other.documentId).toBe('other-doc');
    expect(other.prompt).toContain('{{files}}');
    expect(other.prompt).toContain('{{before_cursor}}');
    expect(other.temperature).toBe(0.7);
    expect(other.maxTokens).toBe(900);
    expect(other.maxContextChars).toBe(50_000);
    expect(other.fileIds).toEqual([]);
    expect(other.autoRun).toBe(false);
  });

  it('reuses a nudger saved as a template in another document', async () => {
    const store = await freshStore();
    const first = await store.createDocument('First', 'Text');
    const second = await store.createDocument('Second', 'Text');
    const source = await store.createNudger(
      newNudgerInput({ documentId: first.id, name: 'Coach', facts: true }),
    );
    const template = await store.saveTemplate(templateFromNudger(source));
    const nudger = nudgerFromTemplate(template, {
      documentId: second.id,
      order: 0,
      settings: DEFAULT_SETTINGS,
    });
    const created = await store.createNudger(nudger);
    expect(created.documentId).toBe(second.id);
    expect(created.name).toBe('Coach template');
    expect(created.facts).toBe(true);
    expect((await store.listNudgers(second.id)).map((n) => n.id)).toEqual([created.id]);
  });

  it('starts a starter nudger on the document it is added to', () => {
    const template = getTemplateById('starter-hiring-manager')!;
    const earlier = nudgerFromTemplate(template, {
      documentId: 'a',
      order: 0,
      settings: DEFAULT_SETTINGS,
    });
    const later = nudgerFromTemplate(template, {
      documentId: 'b',
      order: 3,
      settings: DEFAULT_SETTINGS,
    });
    expect(earlier.documentId).toBe('a');
    expect(later.documentId).toBe('b');
    expect(earlier.prompt).toBe(later.prompt);
  });
});
