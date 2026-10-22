import Dexie, { type Table } from 'dexie';
import type { Document, Nudger, ReferenceFile, Reply, Template, Version } from '../types';
import type { StoredSettings } from './defaults';
import { planFileMigration, planNudgerMigration } from './migrate';

export type SettingsRow = { key: string; value: StoredSettings };

export class NudgerDB extends Dexie {
  documents!: Table<Document, string>;
  versions!: Table<Version, string>;
  files!: Table<ReferenceFile, string>;
  nudgers!: Table<Nudger, string>;
  replies!: Table<Reply, string>;
  templates!: Table<Template, string>;
  settings!: Table<SettingsRow, string>;

  constructor(name = 'nudger') {
    super(name);
    this.version(1).stores({
      documents: 'id, title, createdAt, updatedAt',
      versions: 'id, documentId, createdAt',
      files: 'id, name, createdAt, updatedAt',
      nudgers: 'id, order, createdAt',
      replies: 'id, documentId, nudgerId, createdAt, [documentId+nudgerId]',
      templates: 'id, createdAt',
      settings: 'key',
    });
    // Nudgers are owned by a document. Legacy global nudgers are copied into
    // every existing document and their replies are rewired to the copies.
    this.version(2)
      .stores({ nudgers: 'id, documentId, order, createdAt' })
      .upgrade(async (tx) => {
        const docs = await tx.table('documents').toArray();
        const nudgerRows = (await tx.table('nudgers').toArray()) as Array<
          Omit<Nudger, 'documentId'> & { documentId?: string }
        >;
        const replyRows = await tx.table('replies').toArray();
        const plan = planNudgerMigration(docs, nudgerRows, replyRows);
        await tx.table('nudgers').clear();
        if (plan.nudgers.length) await tx.table('nudgers').bulkPut(plan.nudgers);
        for (const update of plan.replyUpdates) {
          await tx.table('replies').update(update.id, { nudgerId: update.nudgerId });
        }
        if (plan.templates.length) await tx.table('templates').bulkPut(plan.templates);
      });
    // Reference files are owned by a document too. Legacy library files are
    // copied into every existing document and the nudger/reply file ids are
    // pointed at the copies.
    this.version(3)
      .stores({ files: 'id, documentId, name, createdAt, updatedAt' })
      .upgrade(async (tx) => {
        const docs = await tx.table('documents').toArray();
        const fileRows = (await tx.table('files').toArray()) as Array<
          Omit<ReferenceFile, 'documentId'> & { documentId?: string }
        >;
        if (!fileRows.length) return;
        const nudgerRows = await tx.table('nudgers').toArray();
        const replyRows = await tx.table('replies').toArray();
        const plan = planFileMigration(docs, fileRows, nudgerRows, replyRows);
        await tx.table('files').clear();
        if (plan.files.length) await tx.table('files').bulkPut(plan.files);
        for (const update of plan.nudgerUpdates) {
          await tx.table('nudgers').update(update.id, { fileIds: update.fileIds });
        }
        for (const update of plan.replyUpdates) {
          await tx.table('replies').update(update.id, { fileIds: update.fileIds });
        }
      });
    // Nudgers moved to the right of the draft. The old stacked layout was the
    // only default, so a stored 'stacked' is a leftover default rather than a
    // choice; the split view is now the default and can be dragged.
    this.version(4).upgrade(async (tx) => {
      const row = await tx.table('settings').get('app');
      if (!row?.value || row.value.layout !== 'stacked') return;
      await tx.table('settings').put({ ...row, value: { ...row.value, layout: 'side' } });
    });
  }
}

export const db = new NudgerDB();
