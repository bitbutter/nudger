import type {
  Document,
  ExportedBundle,
  Nudger,
  ReferenceFile,
  Reply,
  ReplyStatus,
  Template,
  Version,
} from '../types';
import { db, type NudgerDB } from './db';
import { normalizeSettings, stripApiKey, type StoredSettings } from './defaults';
import { NudgeError } from './errors';
import { clamp, formatDateTime, newId, wordCount } from './util';
import { validateFileName } from './referenceFiles';
import { SCHEMA_VERSION } from './exportImport';
import { STARTER_TEMPLATES } from './starters';
import { getProviderPreset } from './providers';

export type NewNudger = Omit<Nudger, 'id' | 'createdAt' | 'updatedAt' | 'order'> & { order?: number };

export type RestoreResult = {
  restored: Version;
  safetyVersion: Version | null;
  text: string;
};

export type ImportMode = 'merge' | 'replace';

export type ImportSummary = {
  documents: number;
  versions: number;
  files: number;
  nudgers: number;
  replies: number;
  templates: number;
  settingsRestored: boolean;
};

/** Reference file names only have to be unique inside their own document. */
function fileKey(documentId: string, name: string): string {
  return `${documentId}\u0000${name.toLowerCase()}`;
}

/** Keeps only the imported file ids that belong to the given document. */
function remapFileIdsForDocument(
  fileIds: string[],
  documentId: string,
  remap: Map<string, string>,
  fileDocById: Map<string, string>,
): string[] {
  const out: string[] = [];
  for (const id of fileIds) {
    const mapped = remap.get(id) ?? id;
    if (fileDocById.get(mapped) !== documentId) continue;
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out;
}

export function describeStorageError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError' || error.code === 22) {
      return 'Browser storage is full. Export your data, delete some documents, versions or reference files, then try again.';
    }
  }
  if (error instanceof Error && /quota|storage/i.test(error.message)) {
    return `A storage write failed: ${error.message}. Export your data and free some space.`;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function estimateStorage(): Promise<{ usage: number; quota: number; percent: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota, percent: quota > 0 ? (usage / quota) * 100 : 0 };
  } catch {
    return null;
  }
}

export function createStore(database: NudgerDB = db) {
  const documents = database.documents;
  const versions = database.versions;
  const files = database.files;
  const nudgers = database.nudgers;
  const replies = database.replies;
  const templates = database.templates;
  const settingsTable = database.settings;

  async function getSettings() {
    const row = await settingsTable.get('app');
    return normalizeSettings(row?.value as Partial<ReturnType<typeof normalizeSettings>> | undefined);
  }

  async function saveSettings(patch: Partial<ReturnType<typeof normalizeSettings>>) {
    const current = await getSettings();
    const next = normalizeSettings({ ...current, ...patch });
    await settingsTable.put({ key: 'app', value: stripApiKey(next) });
    return next;
  }

  async function setSettings(next: ReturnType<typeof normalizeSettings>) {
    const normalized = normalizeSettings(next);
    await settingsTable.put({ key: 'app', value: stripApiKey(normalized) });
    return normalized;
  }

  // --------------------------------------------------------------- documents

  async function listDocuments(): Promise<Document[]> {
    return documents.orderBy('updatedAt').reverse().toArray();
  }

  async function getDocument(id: string): Promise<Document | undefined> {
    return documents.get(id);
  }

  async function createDocument(title = 'Untitled document', text = ''): Promise<Document> {
    const now = Date.now();
    const doc: Document = {
      id: newId(),
      title: title.trim() || 'Untitled document',
      currentText: text,
      createdAt: now,
      updatedAt: now,
    };
    await documents.add(doc);
    return doc;
  }

  async function updateDocumentText(id: string, text: string): Promise<void> {
    const doc = await documents.get(id);
    if (!doc) throw new Error('This document no longer exists.');
    if (doc.currentText === text) return;
    await documents.update(id, { currentText: text, updatedAt: Date.now() });
  }

  async function renameDocument(id: string, title: string): Promise<void> {
    await documents.update(id, { title: title.trim() || 'Untitled document', updatedAt: Date.now() });
  }

  async function duplicateDocument(id: string): Promise<Document | null> {
    return database.transaction('rw', documents, versions, files, nudgers, async () => {
      const source = await documents.get(id);
      if (!source) return null;
      const now = Date.now();
      const copy: Document = {
        id: newId(),
        title: `${source.title} (copy)`,
        currentText: source.currentText,
        createdAt: now,
        updatedAt: now,
      };
      await documents.add(copy);
      const sourceVersions = await versions.where('documentId').equals(id).toArray();
      for (const version of sourceVersions) {
        await versions.add({
          ...version,
          id: newId(),
          documentId: copy.id,
          createdAt: version.createdAt,
        });
      }
      // Reference files belong to the document, so the copy gets its own files
      // and its nudgers are pointed at those copies.
      const fileIdMap = new Map<string, string>();
      const sourceFiles = await files.where('documentId').equals(id).toArray();
      for (const file of sourceFiles) {
        const fileId = newId();
        fileIdMap.set(file.id, fileId);
        await files.add({
          ...file,
          id: fileId,
          documentId: copy.id,
          createdAt: now,
          updatedAt: now,
        });
      }
      // The copy gets the same nudger setup (prompts, files, budget), but no
      // reply history and no auto-run, matching how duplicating a nudger works.
      const sourceNudgers = await nudgers.where('documentId').equals(id).toArray();
      for (const nudger of sourceNudgers) {
        await nudgers.add({
          ...nudger,
          id: newId(),
          documentId: copy.id,
          fileIds: nudger.fileIds
            .map((fileId) => fileIdMap.get(fileId))
            .filter((fileId): fileId is string => Boolean(fileId)),
          autoRun: false,
          done: false,
          createdAt: now,
          updatedAt: now,
        });
      }
      return copy;
    });
  }

  async function deleteDocument(id: string): Promise<void> {
    await database.transaction('rw', documents, versions, files, nudgers, replies, async () => {
      await documents.delete(id);
      await versions.where('documentId').equals(id).delete();
      await files.where('documentId').equals(id).delete();
      await nudgers.where('documentId').equals(id).delete();
      await replies.where('documentId').equals(id).delete();
    });
  }

  // ---------------------------------------------------------------- versions

  async function listVersions(documentId: string): Promise<Version[]> {
    const rows = await versions.where('documentId').equals(documentId).toArray();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }

  async function listAllVersions(): Promise<Version[]> {
    return versions.toArray();
  }

  async function insertVersion(documentId: string, text: string, label?: string): Promise<Version> {
    const version: Version = {
      id: newId(),
      documentId,
      text,
      label: label?.trim() || undefined,
      createdAt: Date.now(),
      wordCount: wordCount(text),
    };
    await versions.add(version);
    return version;
  }

  async function createVersion(documentId: string, label?: string): Promise<Version> {
    const doc = await documents.get(documentId);
    if (!doc) throw new Error('This document no longer exists.');
    return insertVersion(documentId, doc.currentText, label);
  }

  /** Non-destructive: snapshots the current text before applying the old one, then saves a new version. */
  async function restoreVersion(versionId: string): Promise<RestoreResult> {
    return database.transaction('rw', documents, versions, async () => {
      const source = await versions.get(versionId);
      if (!source) throw new Error('This version no longer exists.');
      const doc = await documents.get(source.documentId);
      if (!doc) throw new Error('The document for this version no longer exists.');

      let safetyVersion: Version | null = null;
      if (doc.currentText !== source.text) {
        safetyVersion = await insertVersion(
          doc.id,
          doc.currentText,
          `Before restore of ${formatDateTime(source.createdAt)}`,
        );
      }
      const label = `Restored from ${formatDateTime(source.createdAt)}${source.label ? ` (${source.label})` : ''}`;
      const restored = await insertVersion(doc.id, source.text, label);
      await documents.update(doc.id, { currentText: source.text, updatedAt: Date.now() });
      return { restored, safetyVersion, text: source.text };
    });
  }

  async function deleteVersion(versionId: string): Promise<void> {
    await versions.delete(versionId);
  }

  // ------------------------------------------------------------------- files

  async function listFiles(documentId?: string): Promise<ReferenceFile[]> {
    const rows = documentId
      ? await files.where('documentId').equals(documentId).toArray()
      : await files.toArray();
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function getFile(id: string): Promise<ReferenceFile | undefined> {
    return files.get(id);
  }

  function assertUniqueName(name: string, existing: ReferenceFile[], exceptId?: string): void {
    const wanted = name.toLowerCase();
    if (existing.some((f) => f.id !== exceptId && f.name.toLowerCase() === wanted)) {
      throw new Error(`A reference file named "${name}" already exists. File names must be unique.`);
    }
  }

  async function createFile(
    documentId: string,
    name: string,
    content: string,
  ): Promise<ReferenceFile> {
    const doc = await documents.get(documentId);
    if (!doc) throw new Error('Choose a document before adding a reference file.');
    const valid = validateFileName(name);
    if (!valid.ok) throw new Error(valid.error);
    const existing = await listFiles(documentId);
    assertUniqueName(valid.name, existing);
    const now = Date.now();
    const file: ReferenceFile = {
      id: newId(),
      documentId,
      name: valid.name,
      kind: valid.kind,
      content,
      createdAt: now,
      updatedAt: now,
      wordCount: wordCount(content),
    };
    await files.add(file);
    return file;
  }

  async function updateFile(
    id: string,
    patch: { name?: string; content?: string },
  ): Promise<ReferenceFile> {
    return database.transaction('rw', files, async () => {
      const current = await files.get(id);
      if (!current) throw new Error('This file no longer exists.');
      let name = current.name;
      let kind = current.kind;
      if (patch.name !== undefined && patch.name !== current.name) {
        const valid = validateFileName(patch.name);
        if (!valid.ok) throw new Error(valid.error);
        const existing = await files.where('documentId').equals(current.documentId).toArray();
        assertUniqueName(valid.name, existing, id);
        name = valid.name;
        kind = valid.kind;
      }
      const content = patch.content !== undefined ? patch.content : current.content;
      const next: ReferenceFile = {
        ...current,
        name,
        kind,
        content,
        updatedAt: Date.now(),
        wordCount: wordCount(content),
      };
      await files.put(next);
      return next;
    });
  }

  async function deleteFile(id: string): Promise<string[]> {
    return database.transaction('rw', files, nudgers, async () => {
      await files.delete(id);
      const affected: string[] = [];
      const using = await nudgers.filter((n) => n.fileIds.includes(id)).toArray();
      for (const nudger of using) {
        affected.push(nudger.name);
        await nudgers.update(nudger.id, {
          fileIds: nudger.fileIds.filter((fileId) => fileId !== id),
          updatedAt: Date.now(),
        });
      }
      return affected;
    });
  }

  // ----------------------------------------------------------------- nudgers

  /** All nudgers, or only the ones owned by one document. */
  async function listNudgers(documentId?: string): Promise<Nudger[]> {
    const rows = documentId
      ? await nudgers.where('documentId').equals(documentId).toArray()
      : await nudgers.toArray();
    return rows.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  }

  async function getNudger(id: string): Promise<Nudger | undefined> {
    return nudgers.get(id);
  }

  async function createNudger(input: NewNudger): Promise<Nudger> {
    const doc = await documents.get(input.documentId);
    if (!doc) throw new Error('The document for this nudger no longer exists.');
    const siblings = await nudgers.where('documentId').equals(input.documentId).toArray();
    const order = input.order ?? siblings.reduce((max, n) => Math.max(max, n.order), -1) + 1;
    const now = Date.now();
    const nudger: Nudger = {
      ...input,
      id: newId(),
      order,
      createdAt: now,
      updatedAt: now,
    };
    await nudgers.add(nudger);
    return nudger;
  }

  async function updateNudger(id: string, patch: Partial<Nudger>): Promise<void> {
    // Ownership is fixed at creation: a patch can edit a nudger, never move it
    // to another document (its files and replies belong to the original one).
    const {
      id: _ignoredId,
      createdAt: _ignoredCreatedAt,
      documentId: _ignoredDocumentId,
      ...safe
    } = patch;
    void _ignoredId;
    void _ignoredCreatedAt;
    void _ignoredDocumentId;
    if (typeof safe.temperature === 'number') safe.temperature = clamp(safe.temperature, 0, 2);
    if (typeof safe.maxTokens === 'number') {
      safe.maxTokens = Math.round(clamp(safe.maxTokens, 1, 64_000));
    }
    if (typeof safe.maxContextChars === 'number') {
      safe.maxContextChars = Math.round(clamp(safe.maxContextChars, 1_000, 2_000_000));
    }
    if (typeof safe.budget === 'number') safe.budget = Math.round(clamp(safe.budget, 0, 10_000));
    await nudgers.update(id, { ...safe, updatedAt: Date.now() });
  }

  async function duplicateNudger(id: string): Promise<Nudger | null> {
    const source = await nudgers.get(id);
    if (!source) return null;
    const siblings = await nudgers.where('documentId').equals(source.documentId).toArray();
    const order = siblings.reduce((max, n) => Math.max(max, n.order), -1) + 1;
    const now = Date.now();
    const copy: Nudger = {
      ...source,
      id: newId(),
      name: `${source.name} (copy)`,
      order,
      autoRun: false,
      done: false,
      budget: 3,
      createdAt: now,
      updatedAt: now,
    };
    await nudgers.add(copy);
    return copy;
  }

  async function deleteNudger(id: string): Promise<void> {
    await database.transaction('rw', nudgers, replies, async () => {
      await nudgers.delete(id);
      await replies.where('nudgerId').equals(id).delete();
    });
  }

  async function moveNudger(id: string, direction: -1 | 1): Promise<void> {
    await database.transaction('rw', nudgers, async () => {
      const current = await nudgers.get(id);
      if (!current) return;
      const ordered = (
        await nudgers.where('documentId').equals(current.documentId).toArray()
      ).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
      const index = ordered.findIndex((n) => n.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ordered.length) return;
      const [moved] = ordered.splice(index, 1);
      ordered.splice(target, 0, moved);
      for (let i = 0; i < ordered.length; i += 1) {
        if (ordered[i].order !== i) await nudgers.update(ordered[i].id, { order: i });
      }
    });
  }

  async function addBudget(id: string, amount = 3): Promise<void> {
    const nudger = await nudgers.get(id);
    if (!nudger) return;
    await nudgers.update(id, { budget: Math.max(0, nudger.budget + amount), updatedAt: Date.now() });
  }

  // ----------------------------------------------------------------- replies

  async function listReplies(documentId: string): Promise<Reply[]> {
    const rows = await replies.where('documentId').equals(documentId).toArray();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }

  async function addReply(
    input: Omit<Reply, 'id' | 'createdAt' | 'status'> & { status?: ReplyStatus },
  ): Promise<Reply> {
    return database.transaction('rw', documents, nudgers, replies, async () => {
      const [document, nudger] = await Promise.all([
        documents.get(input.documentId),
        nudgers.get(input.nudgerId),
      ]);
      if (!document) {
        throw new Error('The document was deleted before the reply arrived, so the reply was not saved.');
      }
      if (!nudger) {
        throw new Error('The nudger was deleted before the reply arrived, so the reply was not saved.');
      }
      if (nudger.documentId !== input.documentId) {
        throw new Error('That nudger belongs to a different document, so the reply was not saved.');
      }
      const reply: Reply = {
        ...input,
        id: newId(),
        createdAt: Date.now(),
        status: input.status ?? 'new',
      };
      await replies.add(reply);
      return reply;
    });
  }

  async function setReplyStatus(id: string, status: ReplyStatus): Promise<void> {
    await replies.update(id, { status });
  }

  async function deleteReply(id: string): Promise<void> {
    await replies.delete(id);
  }

  async function clearReplyHistory(documentId: string, nudgerId: string): Promise<void> {
    await replies.where('[documentId+nudgerId]').equals([documentId, nudgerId]).delete();
  }

  // --------------------------------------------------------------- templates

  async function listCustomTemplates(): Promise<Template[]> {
    const rows = await templates.toArray();
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  }

  async function listTemplates(): Promise<Template[]> {
    return [...STARTER_TEMPLATES, ...(await listCustomTemplates())];
  }

  async function saveTemplate(template: Template): Promise<Template> {
    if (template.builtin || STARTER_TEMPLATES.some((t) => t.id === template.id)) {
      throw new Error('Starter templates are read-only. Duplicate one to make an editable copy.');
    }
    const now = Date.now();
    const existing = await templates.get(template.id);
    const saved: Template = {
      ...template,
      name: template.name.trim() || 'Untitled template',
      builtin: false,
      createdAt: existing?.createdAt ?? template.createdAt ?? now,
      updatedAt: now,
    };
    await templates.put(saved);
    return saved;
  }

  async function deleteTemplate(id: string): Promise<void> {
    if (STARTER_TEMPLATES.some((t) => t.id === id)) {
      throw new Error('Starter templates are read-only.');
    }
    await templates.delete(id);
  }

  // ------------------------------------------------------------ settings/data

  async function listVersionCounts(): Promise<Record<string, number>> {
    const rows = await versions.toArray();
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.documentId] = (counts[row.documentId] ?? 0) + 1;
    return counts;
  }

  async function exportAll(): Promise<ExportedBundle> {
    const [docs, vers, fileRows, nudgerRows, replyRows, templateRows, settings] = await Promise.all([
      documents.toArray(),
      versions.toArray(),
      files.toArray(),
      nudgers.toArray(),
      replies.toArray(),
      templates.toArray(),
      getSettings(),
    ]);
    return {
      app: 'nudger',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: Date.now(),
      documents: docs,
      versions: vers,
      files: fileRows,
      nudgers: nudgerRows,
      replies: replyRows,
      templates: templateRows,
      settings: stripApiKey(settings),
    };
  }

  async function importBundle(
    bundle: ExportedBundle,
    mode: ImportMode,
    options: { restoreNetworkSettings?: boolean } = {},
  ): Promise<ImportSummary> {
    const summary: ImportSummary = {
      documents: 0,
      versions: 0,
      files: 0,
      nudgers: 0,
      replies: 0,
      templates: 0,
      settingsRestored: false,
    };

    const currentSettings = await getSettings();
    await database.transaction(
      'rw',
      [documents, versions, files, nudgers, replies, templates, settingsTable],
      async () => {
        if (mode === 'replace') {
          await Promise.all([
            documents.clear(),
            versions.clear(),
            files.clear(),
            nudgers.clear(),
            replies.clear(),
            templates.clear(),
            settingsTable.clear(),
          ]);
        }

        const docIds = new Set(await documents.toCollection().primaryKeys());
        const fileIds = new Set(await files.toCollection().primaryKeys());
        const nudgerIds = new Set(await nudgers.toCollection().primaryKeys());
        const versionIds = new Set(await versions.toCollection().primaryKeys());
        const replyIds = new Set(await replies.toCollection().primaryKeys());
        const templateIds = new Set(await templates.toCollection().primaryKeys());
        for (const doc of bundle.documents) {
          if (docIds.has(doc.id)) continue;
          await documents.add(doc);
          docIds.add(doc.id);
          summary.documents += 1;
        }

        // Files belong to one document, so a name only has to be unique inside
        // its own document: remap per document, never across the whole library.
        const existing = await files.toArray();
        const existingNames = new Map(
          existing.map((file) => [fileKey(file.documentId, file.name), file.id]),
        );
        const fileDocById = new Map(existing.map((file) => [file.id, file.documentId]));
        const fileIdRemap = new Map<string, string>();

        for (const file of bundle.files) {
          if (!docIds.has(file.documentId)) continue;
          if (fileIds.has(file.id)) {
            fileIdRemap.set(file.id, file.id);
            continue;
          }
          const sameNameId = existingNames.get(fileKey(file.documentId, file.name));
          if (sameNameId) {
            // Reuse the existing file with this name so {{file:name}} keeps working.
            fileIdRemap.set(file.id, sameNameId);
            continue;
          }
          await files.add(file);
          fileIds.add(file.id);
          existingNames.set(fileKey(file.documentId, file.name), file.id);
          fileDocById.set(file.id, file.documentId);
          fileIdRemap.set(file.id, file.id);
          summary.files += 1;
        }

        for (const version of bundle.versions) {
          if (versionIds.has(version.id) || !docIds.has(version.documentId)) continue;
          await versions.add(version);
          versionIds.add(version.id);
          summary.versions += 1;
        }

        for (const nudger of bundle.nudgers) {
          if (nudgerIds.has(nudger.id)) continue;
          if (!docIds.has(nudger.documentId)) continue;
          await nudgers.add({
            ...nudger,
            fileIds: remapFileIdsForDocument(
              nudger.fileIds,
              nudger.documentId,
              fileIdRemap,
              fileDocById,
            ),
          });
          nudgerIds.add(nudger.id);
          summary.nudgers += 1;
        }

        for (const reply of bundle.replies) {
          if (replyIds.has(reply.id)) continue;
          if (!docIds.has(reply.documentId) || !nudgerIds.has(reply.nudgerId)) continue;
          const mappedFileIds = remapFileIdsForDocument(
            reply.fileIds,
            reply.documentId,
            fileIdRemap,
            fileDocById,
          );
          await replies.add({ ...reply, fileIds: mappedFileIds });
          replyIds.add(reply.id);
          summary.replies += 1;
        }

        for (const template of bundle.templates) {
          if (template.builtin) continue;
          if (templateIds.has(template.id)) continue;
          if (STARTER_TEMPLATES.some((t) => t.id === template.id)) continue;
          await templates.add({ ...template, builtin: false });
          templateIds.add(template.id);
          summary.templates += 1;
        }

        if (mode === 'replace') {
          const next = normalizeSettings(bundle.settings);
          // Key storage is a local security preference; an import never changes it.
          next.rememberKey = currentSettings.rememberKey;
          if (!options.restoreNetworkSettings) {
            // Never point the stored API key at a host that arrived in an import.
            // Custom/compatible presets have no base URL; keep the current one in
            // that case rather than leaving the app unusable after an import.
            next.baseUrl = getProviderPreset(next.providerId).baseUrl || currentSettings.baseUrl;
            next.customHeaders = undefined;
          }
          await settingsTable.put({ key: 'app', value: stripApiKey(next) });
          summary.settingsRestored = true;
        }
      },
    );

    return summary;
  }

  async function clearAllData(): Promise<void> {
    await database.transaction(
      'rw',
      [documents, versions, files, nudgers, replies, templates, settingsTable],
      async () => {
        await Promise.all([
          documents.clear(),
          versions.clear(),
          files.clear(),
          nudgers.clear(),
          replies.clear(),
          templates.clear(),
          settingsTable.clear(),
        ]);
      },
    );
  }

  return {
    db: database,
    getSettings,
    saveSettings,
    setSettings,
    listDocuments,
    getDocument,
    createDocument,
    updateDocumentText,
    renameDocument,
    duplicateDocument,
    deleteDocument,
    listVersions,
    listAllVersions,
    createVersion,
    restoreVersion,
    deleteVersion,
    listVersionCounts,
    listFiles,
    getFile,
    createFile,
    updateFile,
    deleteFile,
    listNudgers,
    getNudger,
    createNudger,
    updateNudger,
    duplicateNudger,
    deleteNudger,
    moveNudger,
    addBudget,
    listReplies,
    addReply,
    setReplyStatus,
    deleteReply,
    clearReplyHistory,
    listCustomTemplates,
    listTemplates,
    saveTemplate,
    deleteTemplate,
    exportAll,
    importBundle,
    clearAllData,
  };
}

export type NudgerStore = ReturnType<typeof createStore>;
export const store = createStore();

export function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22);
}

export function nudgeStorageError(error: unknown): NudgeError {
  return new NudgeError('storage', describeStorageError(error), {
    detail: error instanceof Error ? error.message : String(error),
  });
}

export type { StoredSettings };
