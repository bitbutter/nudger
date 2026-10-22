import type { Document, Nudger, ReferenceFile, Reply, Template } from '../types';
import { templateFromNudger } from './starters';
import { newId } from './util';

type LegacyNudger = Omit<Nudger, 'documentId'> & { documentId?: string };
type LegacyFile = Omit<ReferenceFile, 'documentId' | 'nudgerId'> & {
  documentId?: string;
  nudgerId?: string | null;
};

export type NudgerMigrationPlan = {
  /** Every nudger after the migration; document-bound. */
  nudgers: Nudger[];
  /** Replies whose nudgerId points at a migrated copy. */
  replyUpdates: Array<{ id: string; nudgerId: string }>;
  /** Created only when there is no document to attach a legacy nudger to. */
  templates: Template[];
};

/**
 * Nudgers used to be global. They are now owned by one document, so a legacy
 * nudger is copied into every existing document and each document's replies are
 * pointed at its own copy. With no documents at all, the configuration is kept
 * as custom templates instead of being dropped.
 *
 * Pure so the Dexie upgrade and the tests share one implementation.
 */
export function planNudgerMigration(
  documents: Pick<Document, 'id' | 'title' | 'createdAt'>[],
  nudgers: LegacyNudger[],
  replies: Pick<Reply, 'id' | 'documentId' | 'nudgerId'>[],
  now = Date.now(),
): NudgerMigrationPlan {
  const docs = [...documents].sort((a, b) => a.createdAt - b.createdAt);
  const docIds = new Set(docs.map((doc) => doc.id));
  const plan: NudgerMigrationPlan = { nudgers: [], replyUpdates: [], templates: [] };

  const legacy = nudgers.filter((nudger) => !nudger.documentId || !docIds.has(nudger.documentId));
  const legacyIds = new Set(legacy.map((nudger) => nudger.id));
  for (const nudger of nudgers) {
    if (!legacyIds.has(nudger.id)) plan.nudgers.push(nudger as Nudger);
  }
  if (!legacy.length) return plan;

  if (!docs.length) {
    for (const nudger of legacy) {
      plan.templates.push(templateFromNudger(nudger, { id: newId(), now }));
    }
    return plan;
  }

  // legacy id -> document id -> copy id
  const copies = new Map<string, Map<string, string>>();
  for (const nudger of legacy) {
    const perDocument = new Map<string, string>();
    for (const doc of docs) {
      const copy: Nudger = {
        ...nudger,
        id: newId(),
        documentId: doc.id,
        createdAt: nudger.createdAt,
        updatedAt: nudger.updatedAt,
      };
      perDocument.set(doc.id, copy.id);
      plan.nudgers.push(copy);
    }
    copies.set(nudger.id, perDocument);
  }

  for (const reply of replies) {
    const target = copies.get(reply.nudgerId)?.get(reply.documentId);
    if (target) plan.replyUpdates.push({ id: reply.id, nudgerId: target });
  }

  return plan;
}

export type FileMigrationPlan = {
  /** Every reference file after the migration; document-bound. */
  files: ReferenceFile[];
  /** Nudgers whose attached file ids now point at their document's copies. */
  nudgerUpdates: Array<{ id: string; fileIds: string[] }>;
  /** Replies whose recorded file ids now point at their document's copies. */
  replyUpdates: Array<{ id: string; fileIds: string[] }>;
};

function remapFileIds(
  fileIds: string[],
  documentId: string,
  copies: Map<string, Map<string, string>>,
  ownIds: Set<string>,
): string[] | null {
  const out: string[] = [];
  const seen = new Set<string>();
  let changed = false;
  for (const id of fileIds) {
    const mapped = copies.get(id)?.get(documentId) ?? (ownIds.has(id) ? id : undefined);
    if (!mapped) {
      changed = true;
      continue;
    }
    if (mapped !== id) changed = true;
    if (seen.has(mapped)) continue;
    seen.add(mapped);
    out.push(mapped);
  }
  return changed ? out : null;
}

/**
 * Reference files used to be one shared library. They are now owned by one
 * document, so a legacy file is copied into every existing document and each
 * document's nudgers and replies are pointed at its own copies. With no
 * documents at all there is nothing a legacy file could belong to, so it is
 * dropped: no nudger can have attached it either.
 *
 * Pure so the Dexie upgrade and the tests share one implementation.
 */
export function planFileMigration(
  documents: Pick<Document, 'id' | 'title' | 'createdAt'>[],
  files: LegacyFile[],
  nudgers: Pick<Nudger, 'id' | 'documentId' | 'fileIds'>[],
  replies: Pick<Reply, 'id' | 'documentId' | 'fileIds'>[],
): FileMigrationPlan {
  const docs = [...documents].sort((a, b) => a.createdAt - b.createdAt);
  const docIds = new Set(docs.map((doc) => doc.id));
  const plan: FileMigrationPlan = { files: [], nudgerUpdates: [], replyUpdates: [] };

  const legacyIds = new Set(
    files.filter((file) => !file.documentId || !docIds.has(file.documentId)).map((file) => file.id),
  );
  const ownIds = new Set<string>();
  for (const file of files) {
    if (legacyIds.has(file.id)) continue;
    ownIds.add(file.id);
    plan.files.push(file as ReferenceFile);
  }
  if (!legacyIds.size || !docs.length) return plan;

  const legacy = files.filter((file) => legacyIds.has(file.id));
  // legacy id -> document id -> copy id
  const copies = new Map<string, Map<string, string>>();
  for (const file of legacy) {
    const perDocument = new Map<string, string>();
    for (const doc of docs) {
      const copy: ReferenceFile = {
        ...(file as Omit<ReferenceFile, 'documentId' | 'nudgerId'>),
        id: newId(),
        documentId: doc.id,
        nudgerId: null,
      };
      perDocument.set(doc.id, copy.id);
      plan.files.push(copy);
    }
    copies.set(file.id, perDocument);
  }

  for (const nudger of nudgers) {
    const fileIds = remapFileIds(nudger.fileIds, nudger.documentId, copies, ownIds);
    if (fileIds) plan.nudgerUpdates.push({ id: nudger.id, fileIds });
  }
  for (const reply of replies) {
    const fileIds = remapFileIds(reply.fileIds, reply.documentId, copies, ownIds);
    if (fileIds) plan.replyUpdates.push({ id: reply.id, fileIds });
  }

  return plan;
}

type OwnershipFile = Omit<ReferenceFile, 'nudgerId'> & { nudgerId?: string | null };

export type FileOwnershipPlan = {
  /** Every file after the migration; `nudgerId` is set where a nudger own it. */
  files: ReferenceFile[];
  nudgerUpdates: Array<{ id: string; fileIds: string[] }>;
  replyUpdates: Array<{ id: string; fileIds: string[] }>;
};

/**
 * Reference files used to belong to a document and were attached to nudgers by
 * id. They belong to exactly one nudger now: a file attached to several nudgers
 * becomes one independent copy per nudger, and a file nobody attaches is kept
 * with `nudgerId: null` so the document can show it as unassigned instead of
 * deleting the writer's material.
 *
 * Pure so the Dexie upgrade and importer share one implementation.
 */
export function planFileOwnershipMigration(
  fileRows: OwnershipFile[],
  nudgerRows: Nudger[],
  replyRows: Pick<Reply, 'id' | 'nudgerId' | 'fileIds'>[] = [],
  now = Date.now(),
): FileOwnershipPlan {
  void now;
  const nudgerFileIds = new Map<string, string[]>(
    nudgerRows.map((nudger) => [nudger.id, [...nudger.fileIds]]),
  );
  const replyFileIds = new Map<string, string[]>(
    replyRows.map((reply) => [reply.id, [...reply.fileIds]]),
  );
  const nudgersByDocument = new Map<string, Nudger[]>();
  for (const nudger of nudgerRows) {
    const list = nudgersByDocument.get(nudger.documentId) ?? [];
    list.push(nudger);
    nudgersByDocument.set(nudger.documentId, list);
  }
  for (const list of nudgersByDocument.values()) {
    list.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  }

  const files: ReferenceFile[] = [];
  for (const file of fileRows) {
    const candidates = nudgersByDocument.get(file.documentId) ?? [];
    const owners = candidates.filter((nudger) =>
      (nudgerFileIds.get(nudger.id) ?? []).includes(file.id),
    );
    if (!owners.length) {
      files.push({ ...file, nudgerId: file.nudgerId ?? null });
      continue;
    }
    owners.forEach((owner, index) => {
      const ownedIds = nudgerFileIds.get(owner.id) ?? [];
      if (index === 0) {
        files.push({ ...file, nudgerId: owner.id });
        return;
      }
      const copyId = newId();
      files.push({ ...file, id: copyId, nudgerId: owner.id });
      nudgerFileIds.set(
        owner.id,
        ownedIds.map((id) => (id === file.id ? copyId : id)),
      );
      for (const reply of replyRows) {
        if (reply.nudgerId !== owner.id) continue;
        const ids = replyFileIds.get(reply.id) ?? [];
        if (!ids.includes(file.id)) continue;
        replyFileIds.set(
          reply.id,
          ids.map((id) => (id === file.id ? copyId : id)),
        );
      }
    });
  }

  const nudgerUpdates: FileOwnershipPlan['nudgerUpdates'] = [];
  for (const nudger of nudgerRows) {
    const next = nudgerFileIds.get(nudger.id) ?? [];
    if (next.join(' ') !== nudger.fileIds.join(' ')) {
      nudgerUpdates.push({ id: nudger.id, fileIds: next });
    }
  }
  const replyUpdates: FileOwnershipPlan['replyUpdates'] = [];
  for (const reply of replyRows) {
    const next = replyFileIds.get(reply.id) ?? [];
    if (next.join(' ') !== reply.fileIds.join(' ')) {
      replyUpdates.push({ id: reply.id, fileIds: next });
    }
  }

  return { files, nudgerUpdates, replyUpdates };
}
