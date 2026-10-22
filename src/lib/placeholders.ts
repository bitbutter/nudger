import type { ReferenceFile } from '../types';
import { clamp, dateStamp } from './util';
import { renderFilesSection } from './referenceFiles';

export const CONTEXT_PLACEHOLDERS = [
  'before_cursor',
  'before_last_word',
  'current_paragraph',
  'after_cursor',
  'full_text',
  'selection',
] as const;

export const META_PLACEHOLDERS = ['document_title', 'nudger_name', 'date'] as const;

export const CONTEXT_PLACEHOLDER_HELP: Record<(typeof CONTEXT_PLACEHOLDERS)[number], string> = {
  before_cursor: 'Everything from the start of the document to the cursor.',
  before_last_word: 'Everything up to the start of the word being typed; same as {{before_cursor}} when no word is in progress.',
  current_paragraph: 'The paragraph around the cursor, split on blank lines.',
  after_cursor: 'Everything after the cursor / selection.',
  full_text: 'The whole document.',
  selection: 'The selected text, or empty.',
};

export const META_PLACEHOLDER_HELP: Record<(typeof META_PLACEHOLDERS)[number], string> = {
  document_title: 'The current document title.',
  nudger_name: 'The nudger name.',
  date: 'Today as YYYY-MM-DD.',
};

export type TemplateIssueKind =
  | 'missing-file'
  | 'unselected-file'
  | 'unknown-placeholder'
  | 'unreferenced-file';

export type TemplateIssue = {
  kind: TemplateIssueKind;
  message: string;
  blocking: boolean;
  name?: string;
};

export type ResolveContext = {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  documentTitle: string;
  nudgerName: string;
  /** Selected files that still exist, in the nudger's order. */
  files: ReferenceFile[];
  /** Every file name in the document, for distinguishing "not attached" from "missing". */
  allFileNames?: string[];
  now?: Date;
};

export type ResolveTextResult = {
  text: string;
  issues: TemplateIssue[];
  hadFilePlaceholder: boolean;
  usedFiles: ReferenceFile[];
};

const TOKEN_RE = /\{\{\s*([^{}\n]*?)\s*\}\}/g;

export function selectedFilesForNudger(
  fileIds: string[],
  files: ReferenceFile[],
): ReferenceFile[] {
  const byId = new Map(files.map((f) => [f.id, f]));
  const seen = new Set<string>();
  const out: ReferenceFile[] = [];
  for (const id of fileIds) {
    const file = byId.get(id);
    if (file && !seen.has(file.id)) {
      seen.add(file.id);
      out.push(file);
    }
  }
  return out;
}

export function paragraphAt(text: string, cursor: number): string {
  if (!text) return '';
  const index = clamp(cursor, 0, text.length);
  const ranges: { start: number; end: number }[] = [];
  let offset = 0;
  let start: number | null = null;
  let lastLineEnd = 0;
  const lines = text.split('\n');
  for (const line of lines) {
    const lineEnd = offset + line.length;
    if (line.trim() !== '') {
      if (start === null) start = offset;
      lastLineEnd = lineEnd;
    } else if (start !== null) {
      ranges.push({ start, end: lastLineEnd });
      start = null;
    }
    offset = lineEnd + 1;
  }
  if (start !== null) ranges.push({ start, end: lastLineEnd });
  if (!ranges.length) return text;

  const containing = ranges.find((r) => index >= r.start && index <= r.end);
  if (containing) return text.slice(containing.start, containing.end);
  const next = ranges.find((r) => r.start > index);
  if (next) return text.slice(next.start, next.end);
  const last = ranges[ranges.length - 1];
  return text.slice(last.start, last.end);
}

export function textBeforeLastWord(text: string, cursor: number): string {
  const before = text.slice(0, clamp(cursor, 0, text.length));
  const match = /[\p{L}\p{N}_'’-]+$/u.exec(before);
  return match ? before.slice(0, match.index) : before;
}

function findSelectedFile(name: string, files: ReferenceFile[]): ReferenceFile | undefined {
  const wanted = name.trim().toLowerCase();
  return files.find((f) => f.name.toLowerCase() === wanted);
}

export function resolveTemplateText(raw: string, ctx: ResolveContext): ResolveTextResult {
  const issues: TemplateIssue[] = [];
  const used = new Map<string, ReferenceFile>();
  let hadFilePlaceholder = false;
  const length = ctx.text.length;
  const start = clamp(ctx.selectionStart, 0, length);
  const end = clamp(Math.max(start, ctx.selectionEnd), 0, length);
  const now = ctx.now ?? new Date();
  const allNames = ctx.allFileNames ?? ctx.files.map((f) => f.name);

  const values = (): Record<string, string> => ({
    before_cursor: ctx.text.slice(0, start),
    before_last_word: textBeforeLastWord(ctx.text, start),
    current_paragraph: paragraphAt(ctx.text, start),
    after_cursor: ctx.text.slice(end),
    full_text: ctx.text,
    selection: ctx.text.slice(start, end),
    document_title: ctx.documentTitle,
    nudger_name: ctx.nudgerName,
    date: dateStamp(now.getTime()),
  });

  const resolvedValues = values();

  const text = raw.replace(TOKEN_RE, (token, rawKey: string) => {
    const key = rawKey.trim();
    const lower = key.toLowerCase();

    if (lower === 'files') {
      hadFilePlaceholder = true;
      for (const file of ctx.files) used.set(file.id, file);
      return ctx.files.length ? renderFilesSection(ctx.files) : '';
    }

    if (lower.startsWith('file:')) {
      hadFilePlaceholder = true;
      const name = key.slice(key.indexOf(':') + 1).trim();
      if (!name) {
        issues.push({
          kind: 'missing-file',
          blocking: true,
          message: 'Empty file placeholder. Use {{file:name.txt}} with an exact file name.',
        });
        return '[[NUDGER: empty reference file placeholder]]';
      }
      const found = findSelectedFile(name, ctx.files);
      if (found) {
        used.set(found.id, found);
        return renderFilesSection([found]);
      }
      const exists = allNames.some((n) => n.toLowerCase() === name.toLowerCase());
      issues.push(
        exists
          ? {
              kind: 'unselected-file',
              blocking: true,
              name,
              message: `Reference file "${name}" exists but is not attached to this nudger. Attach it in the nudger editor, or remove the placeholder.`,
            }
          : {
              kind: 'missing-file',
              blocking: true,
              name,
              message: `Reference file "${name}" does not exist in this document. Create it in this document's Files, attach it, or fix the file name in the template.`,
            },
      );
      return `[[NUDGER: reference file "${name}" is unavailable — the run is blocked]]`;
    }

    if (Object.hasOwn(resolvedValues, lower)) return resolvedValues[lower];

    issues.push({
      kind: 'unknown-placeholder',
      blocking: false,
      name: key,
      message: `Unknown placeholder {{${key}}}. It will be sent literally.`,
    });
    return token;
  });

  return { text, issues, hadFilePlaceholder, usedFiles: [...used.values()] };
}

export function isContextPlaceholder(name: string): boolean {
  return (CONTEXT_PLACEHOLDERS as readonly string[]).includes(name);
}

export function hasContextPlaceholder(template: string): boolean {
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(template)) !== null) {
    if (isContextPlaceholder(m[1].trim())) return true;
  }
  return false;
}

/** File placeholders in order of appearance. null = {{files}} (all attached files). */
export function listFilePlaceholders(template: string): (string | null)[] {
  const out: (string | null)[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(template)) !== null) {
    const key = m[1].trim();
    if (key.toLowerCase() === 'files') out.push(null);
    else if (key.toLowerCase().startsWith('file:')) {
      out.push(key.slice(key.indexOf(':') + 1).trim());
    }
  }
  return out;
}

export function referencedFileNames(template: string): string[] {
  return listFilePlaceholders(template).filter((n): n is string => Boolean(n));
}
