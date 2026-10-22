import { afterEach, describe, expect, it } from 'vitest';
import { makeStore } from './helpers';

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

describe('versions', () => {
  it('saves a version with a word count and full text', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('Essay', 'One two three');
    const version = await store.createVersion(doc.id, 'First pass');
    expect(version.documentId).toBe(doc.id);
    expect(version.text).toBe('One two three');
    expect(version.wordCount).toBe(3);
    expect(version.label).toBe('First pass');
    expect(await store.listVersions(doc.id)).toHaveLength(1);
  });

  it('autosave updates the draft without creating permanent versions', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('Essay', 'Draft one');
    await store.updateDocumentText(doc.id, 'Draft one, now longer');
    const updated = await store.getDocument(doc.id);
    expect(updated?.currentText).toBe('Draft one, now longer');
    expect(await store.listVersions(doc.id)).toHaveLength(0);
  });

  it('restores non-destructively: current text is snapshotted and a new version is created', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('Essay', 'Version A');
    const first = await store.createVersion(doc.id, 'first');
    await store.updateDocumentText(doc.id, 'Version B');
    const versionsBefore = await store.listVersions(doc.id);
    expect(versionsBefore).toHaveLength(1);

    const result = await store.restoreVersion(first.id);
    expect(result.text).toBe('Version A');
    expect(result.safetyVersion?.text).toBe('Version B');
    expect(result.safetyVersion?.label).toContain('Before restore');
    expect(result.restored.label).toContain('Restored from');
    expect((await store.getDocument(doc.id))?.currentText).toBe('Version A');

    const versionsAfter = await store.listVersions(doc.id);
    expect(versionsAfter).toHaveLength(3);
    expect(versionsAfter.some((v) => v.text === 'Version B')).toBe(true);
  });

  it('does not create a redundant safety version when the text already matches', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('Essay', 'Same');
    const version = await store.createVersion(doc.id);
    const result = await store.restoreVersion(version.id);
    expect(result.safetyVersion).toBeNull();
    expect(await store.listVersions(doc.id)).toHaveLength(2);
  });

  it('duplicates a document with its versions', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('Essay', 'Body');
    await store.createVersion(doc.id, 'snap');
    const copy = await store.duplicateDocument(doc.id);
    expect(copy?.title).toBe('Essay (copy)');
    expect(copy?.currentText).toBe('Body');
    expect(await store.listVersions(copy!.id)).toHaveLength(1);
    expect(await store.listVersionCounts()).toEqual({ [doc.id]: 1, [copy!.id]: 1 });
  });

  it('deletes versions', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('Essay', 'Body');
    const version = await store.createVersion(doc.id);
    await store.deleteVersion(version.id);
    expect(await store.listVersions(doc.id)).toHaveLength(0);
  });
});
