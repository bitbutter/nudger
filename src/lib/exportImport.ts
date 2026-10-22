import type {
  Document,
  ExportedBundle,
  Nudger,
  ReferenceFile,
  Reply,
  ReplyStatus,
  Settings,
  Template,
  Version,
} from '../types';
import { normalizeSettings } from './defaults';
import { validateFileName } from './referenceFiles';
import { wordCount } from './util';
import { GENERIC_FACTS_FOCUS } from './facts';

export type ValidationResult =
  | { ok: true; bundle: ExportedBundle; warnings: string[] }
  | { ok: false; errors: string[] };

const REPLY_STATUSES: ReplyStatus[] = ['new', 'pinned', 'dismissed', 'archived'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function validateBundle(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObject(raw)) return { ok: false, errors: ['The file is not a JSON object.'] };
  if (raw.app !== 'nudger') {
    errors.push('This does not look like a nudger export (missing "app": "nudger").');
  }
  if (raw.schemaVersion !== 1) {
    errors.push(`Unsupported export version: ${String(raw.schemaVersion)}. This build reads version 1 exports.`);
  }
  if (errors.length) return { ok: false, errors };

  const rawDocuments = Array.isArray(raw.documents) ? raw.documents : [];
  const rawVersions = Array.isArray(raw.versions) ? raw.versions : [];
  const rawFiles = Array.isArray(raw.files) ? raw.files : [];
  const rawNudgers = Array.isArray(raw.nudgers) ? raw.nudgers : [];
  const rawReplies = Array.isArray(raw.replies) ? raw.replies : [];
  const rawTemplates = Array.isArray(raw.templates) ? raw.templates : [];
  for (const key of ['documents', 'versions', 'files', 'nudgers', 'replies', 'templates']) {
    if (!Array.isArray(raw[key])) warnings.push(`"${key}" is missing or not an array; treating it as empty.`);
  }

  const documents: Document[] = [];
  const documentIds = new Set<string>();
  for (const item of rawDocuments) {
    if (!isObject(item) || typeof item.id !== 'string' || !item.id) {
      warnings.push('Skipped a document without an id.');
      continue;
    }
    if (documentIds.has(item.id)) {
      warnings.push(`Skipped a duplicate document id (${item.id}).`);
      continue;
    }
    documentIds.add(item.id);
    documents.push({
      id: item.id,
      title: asString(item.title, 'Untitled document').trim() || 'Untitled document',
      currentText: asString(item.currentText),
      createdAt: asNumber(item.createdAt, Date.now()),
      updatedAt: asNumber(item.updatedAt, asNumber(item.createdAt, Date.now())),
    });
  }

  const versions: Version[] = [];
  const versionIds = new Set<string>();
  for (const item of rawVersions) {
    if (
      !isObject(item) ||
      typeof item.id !== 'string' ||
      typeof item.documentId !== 'string' ||
      !documentIds.has(item.documentId) ||
      typeof item.text !== 'string'
    ) {
      warnings.push('Skipped a version with a missing id, document, or text.');
      continue;
    }
    if (versionIds.has(item.id)) continue;
    versionIds.add(item.id);
    versions.push({
      id: item.id,
      documentId: item.documentId,
      text: item.text,
      label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : undefined,
      createdAt: asNumber(item.createdAt, Date.now()),
      wordCount: wordCount(item.text),
    });
  }

  const files: ReferenceFile[] = [];
  const fileIds = new Set<string>();
  const fileNames = new Set<string>();
  for (const item of rawFiles) {
    if (!isObject(item) || typeof item.id !== 'string' || typeof item.content !== 'string') {
      warnings.push('Skipped a reference file without an id or text content.');
      continue;
    }
    const valid = validateFileName(asString(item.name));
    if (!valid.ok) {
      warnings.push(`Skipped reference file "${asString(item.name, '(unnamed)')}": ${valid.error}`);
      continue;
    }
    if (fileIds.has(item.id) || fileNames.has(valid.name.toLowerCase())) {
      warnings.push(`Skipped a duplicate reference file (${valid.name}).`);
      continue;
    }
    fileIds.add(item.id);
    fileNames.add(valid.name.toLowerCase());
    files.push({
      id: item.id,
      name: valid.name,
      kind: valid.kind,
      content: item.content,
      createdAt: asNumber(item.createdAt, Date.now()),
      updatedAt: asNumber(item.updatedAt, asNumber(item.createdAt, Date.now())),
      wordCount: wordCount(item.content),
    });
  }

  const nudgers: Nudger[] = [];
  const nudgerIds = new Set<string>();
  for (const item of rawNudgers) {
    if (!isObject(item) || typeof item.id !== 'string' || typeof item.name !== 'string') {
      warnings.push('Skipped a nudger without an id or name.');
      continue;
    }
    if (nudgerIds.has(item.id)) continue;
    nudgerIds.add(item.id);
    nudgers.push({
      id: item.id,
      name: item.name.trim() || 'Untitled nudger',
      description: typeof item.description === 'string' ? item.description : undefined,
      color: typeof item.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(item.color) ? item.color : '#7aa2f7',
      system: asString(item.system),
      prompt: asString(item.prompt, 'Draft:\n{{before_cursor}}'),
      fileIds: asStringArray(item.fileIds).filter((id) => fileIds.has(id)),
      // Imported nudgers always use the local provider and never start auto-running.
      // This prevents an imported pack from redirecting the stored key to another
      // preset host or spending silently on the next typing pause. A model tied to
      // a dropped provider override is dropped too, so the import cannot leave a
      // guaranteed provider error on the card.
      providerId: undefined,
      model:
        typeof item.providerId !== 'string' &&
        typeof item.model === 'string' &&
        item.model.trim()
          ? item.model.trim()
          : undefined,
      temperature: Math.max(0, Math.min(2, asNumber(item.temperature, 0.4))),
      maxTokens: Math.max(1, Math.min(64_000, Math.round(asNumber(item.maxTokens, 700)))),
      maxContextChars: Math.max(
        1_000,
        Math.min(2_000_000, Math.round(asNumber(item.maxContextChars, 100_000))),
      ),
      autoRun: false,
      enabled: asBoolean(item.enabled, true),
      done: asBoolean(item.done),
      budget: Math.max(0, Math.min(10_000, Math.round(asNumber(item.budget, 3)))),
      facts: asBoolean(item.facts, false),
      factsPrompt:
        typeof item.factsPrompt === 'string' && item.factsPrompt.trim()
          ? item.factsPrompt.trim()
          : GENERIC_FACTS_FOCUS,
      order: asNumber(item.order, nudgers.length),
      templateId: typeof item.templateId === 'string' ? item.templateId : undefined,
      createdAt: asNumber(item.createdAt, Date.now()),
      updatedAt: asNumber(item.updatedAt, asNumber(item.createdAt, Date.now())),
    });
  }

  const replies: Reply[] = [];
  const replyIds = new Set<string>();
  for (const item of rawReplies) {
    if (
      !isObject(item) ||
      typeof item.id !== 'string' ||
      typeof item.documentId !== 'string' ||
      typeof item.nudgerId !== 'string' ||
      typeof item.text !== 'string'
    ) {
      warnings.push('Skipped a reply without an id, document, nudger or text.');
      continue;
    }
    if (replyIds.has(item.id)) continue;
    if (!documentIds.has(item.documentId) || !nudgerIds.has(item.nudgerId)) {
      warnings.push('Skipped a reply whose document or nudger is not in the export.');
      continue;
    }
    replyIds.add(item.id);
    const status = typeof item.status === 'string' && REPLY_STATUSES.includes(item.status as ReplyStatus)
      ? (item.status as ReplyStatus)
      : 'new';
    replies.push({
      id: item.id,
      documentId: item.documentId,
      nudgerId: item.nudgerId,
      text: item.text,
      resolvedPrompt: asString(item.resolvedPrompt),
      fileIds: asStringArray(item.fileIds),
      model: asString(item.model),
      provider: asString(item.provider),
      createdAt: asNumber(item.createdAt, Date.now()),
      status,
      error: typeof item.error === 'string' ? item.error : undefined,
      usage: isObject(item.usage)
        ? {
            inputTokens:
              typeof item.usage.inputTokens === 'number' ? item.usage.inputTokens : undefined,
            outputTokens:
              typeof item.usage.outputTokens === 'number' ? item.usage.outputTokens : undefined,
          }
        : undefined,
      facts: asStringArray(item.facts).slice(0, 5),
      factsError: typeof item.factsError === 'string' ? item.factsError : undefined,
    });
  }

  const templates: Template[] = [];
  const templateIds = new Set<string>();
  for (const item of rawTemplates) {
    if (
      !isObject(item) ||
      typeof item.id !== 'string' ||
      typeof item.name !== 'string' ||
      typeof item.prompt !== 'string'
    ) {
      warnings.push('Skipped a template without an id, name or prompt.');
      continue;
    }
    if (templateIds.has(item.id) || asBoolean(item.builtin)) continue;
    templateIds.add(item.id);
    templates.push({
      id: item.id,
      name: item.name.trim() || 'Untitled template',
      description: asString(item.description),
      system: asString(item.system),
      prompt: item.prompt,
      facts: asBoolean(item.facts, false),
      factsPrompt: typeof item.factsPrompt === 'string' ? item.factsPrompt : undefined,
      builtin: false,
      createdAt: asNumber(item.createdAt, Date.now()),
      updatedAt: asNumber(item.updatedAt, asNumber(item.createdAt, Date.now())),
    });
  }

  const settings: Omit<Settings, 'apiKey'> = normalizeSettings(
    isObject(raw.settings) ? (raw.settings as Partial<Settings>) : undefined,
  );

  return {
    ok: true,
    warnings,
    bundle: {
      app: 'nudger',
      schemaVersion: 1,
      exportedAt: asNumber(raw.exportedAt, Date.now()),
      documents,
      versions,
      files,
      nudgers,
      replies,
      templates,
      settings,
    },
  };
}

export function exportFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `nudger-export-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
}
