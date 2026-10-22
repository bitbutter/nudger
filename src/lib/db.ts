import Dexie, { type Table } from 'dexie';
import type { Document, Nudger, ReferenceFile, Reply, Template, Version } from '../types';
import type { StoredSettings } from './defaults';

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
  }
}

export const db = new NudgerDB();
