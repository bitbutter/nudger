import type { Document, Nudger, Reply, Template } from '../types';
import { templateFromNudger } from './starters';
import { newId } from './util';

type LegacyNudger = Omit<Nudger, 'documentId'> & { documentId?: string };

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
