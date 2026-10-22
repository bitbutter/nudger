import type { Caret, Document, Nudger, ReferenceFile, Reply, Settings } from '../types';
import { asNudgeError, NudgeError } from './errors';
import type { ResolvedProvider, ModelUsage } from './providers';
import { callModel, resolveProviderConfig, effectiveCustomHeaders } from './providers';
import {
  resolveTemplateText,
  selectedFilesForNudger,
  type TemplateIssue,
} from './placeholders';
import { appendFilesSection } from './referenceFiles';
import { estimateTokens } from './util';

export type PrepareOptions = {
  nudger: Nudger;
  document: Pick<Document, 'id' | 'title' | 'currentText'>;
  caret: Caret;
  /** The whole library. Selected files are derived from nudger.fileIds. */
  files: ReferenceFile[];
  settings: Settings;
  /** When true, trim the prompt to the character limit instead of only warning. */
  trimToLimit?: boolean;
};

export type PreparedRun = {
  nudgerId: string;
  nudgerName: string;
  documentId: string;
  documentTitle: string;
  system: string;
  prompt: string;
  /** Human-readable exact record of both messages. Also stored on each reply. */
  fullPrompt: string;
  issues: TemplateIssue[];
  blocking: boolean;
  configError?: string;
  autoAppended: boolean;
  sentFiles: ReferenceFile[];
  unreferencedFiles: ReferenceFile[];
  totalChars: number;
  estimatedTokens: number;
  maxContextChars: number;
  overLimit: boolean;
  trimmed: boolean;
  resolved: ResolvedProvider;
  fileIds: string[];
  hadFilePlaceholder: boolean;
};

export function formatResolvedPrompt(system: string, user: string): string {
  return `=== SYSTEM ===\n${system.trim() || '(none)'}\n\n=== USER ===\n${user}`;
}

function truncationMarker(limit: number): string {
  return `\n\n[TRUNCATED BY NUDGER: this prompt was trimmed to stay under the ${limit.toLocaleString()} character limit. The text after this marker was not sent. The request preview shows exactly what is sent.]`;
}

export function truncateWithMarker(text: string, limit: number): string {
  if (limit <= 0) return '';
  if (text.length <= limit) return text;
  const marker = truncationMarker(limit);
  const room = Math.max(0, limit - marker.length);
  return (text.slice(0, room) + marker).slice(0, limit);
}

/**
 * Explicit trim for an oversized user prompt. Keeps the beginning (typically
 * instructions and file headers) and the end (typically the text nearest the
 * cursor), and drops the middle with a visible marker. The preview always shows
 * the result before it is sent.
 */
export function trimPromptMiddle(text: string, limit: number): string {
  if (limit <= 0) return '';
  if (text.length <= limit) return text;
  const marker = `

[TRUNCATED BY NUDGER: the middle of this prompt was removed to stay under the ${limit.toLocaleString()} character limit. The text on either side of this marker is what will be sent. Nothing else is sent.]

`;
  const room = Math.max(0, limit - marker.length);
  const head = Math.floor(room * 0.45);
  const tail = room - head;
  const out = `${text.slice(0, head)}${marker}${text.slice(text.length - tail)}`;
  return out.length > limit ? out.slice(0, limit) : out;
}

function trimPrompts(system: string, prompt: string, limit: number): { system: string; prompt: string } {
  let nextSystem = system;
  if (system.length > limit * 0.5) {
    nextSystem = truncateWithMarker(system, Math.floor(limit * 0.5));
  }
  const promptRoom = Math.max(0, limit - nextSystem.length);
  const nextPrompt = trimPromptMiddle(prompt, promptRoom);
  return { system: nextSystem, prompt: nextPrompt };
}

export function prepareRun(options: PrepareOptions): PreparedRun {
  const { nudger, document, caret, settings } = options;
  const selected = selectedFilesForNudger(nudger.fileIds, options.files);
  const ctx = {
    text: document.currentText,
    selectionStart: caret.start,
    selectionEnd: caret.end,
    documentTitle: document.title,
    nudgerName: nudger.name,
    files: selected,
    allFileNames: options.files.map((f) => f.name),
  };

  const systemResolution = resolveTemplateText(nudger.system, ctx);
  const promptResolution = resolveTemplateText(nudger.prompt, ctx);

  let prompt = promptResolution.text;
  const used = new Map<string, ReferenceFile>();
  for (const file of systemResolution.usedFiles) used.set(file.id, file);
  for (const file of promptResolution.usedFiles) used.set(file.id, file);

  const hadFilePlaceholder = systemResolution.hadFilePlaceholder || promptResolution.hadFilePlaceholder;
  let autoAppended = false;
  if (!hadFilePlaceholder && selected.length > 0) {
    prompt = appendFilesSection(prompt, selected);
    for (const file of selected) used.set(file.id, file);
    autoAppended = true;
  }

  const unreferencedFiles = hadFilePlaceholder
    ? selected.filter((file) => !used.has(file.id))
    : [];

  const issues: TemplateIssue[] = [];
  const seenIssues = new Set<string>();
  for (const issue of [...systemResolution.issues, ...promptResolution.issues]) {
    const key = `${issue.kind}:${issue.name ?? ''}:${issue.message}`;
    if (seenIssues.has(key)) continue;
    seenIssues.add(key);
    issues.push(issue);
  }
  for (const file of unreferencedFiles) {
    const key = `unreferenced:${file.id}`;
    if (seenIssues.has(key)) continue;
    seenIssues.add(key);
    issues.push({
      kind: 'unreferenced-file',
      blocking: false,
      name: file.name,
      message: `"${file.name}" is attached but not referenced by any file placeholder, so it will not be sent. Use {{files}} or {{file:${file.name}}}, or detach it.`,
    });
  }

  const resolved = resolveProviderConfig(settings, nudger);
  const configError = !resolved.model
    ? 'No model is set. Choose one in Settings or the nudger editor.'
    : !resolved.baseUrl
      ? 'No base URL is set. Choose a provider in Settings or enter a base URL.'
      : undefined;

  const maxContextChars = Math.max(1_000, nudger.maxContextChars || settings.maxContextChars);
  let system = systemResolution.text;
  let overLimit = system.length + prompt.length > maxContextChars;
  let trimmed = false;
  if (overLimit && options.trimToLimit) {
    const next = trimPrompts(system, prompt, maxContextChars);
    system = next.system;
    prompt = next.prompt;
    trimmed = true;
    overLimit = system.length + prompt.length > maxContextChars;
  }

  const totalChars = system.length + prompt.length;
  const sentFiles = selected.filter((file) => used.has(file.id));

  return {
    nudgerId: nudger.id,
    nudgerName: nudger.name,
    documentId: document.id,
    documentTitle: document.title,
    system,
    prompt,
    fullPrompt: formatResolvedPrompt(system, prompt),
    issues,
    blocking: issues.some((issue) => issue.blocking) || Boolean(configError),
    configError,
    autoAppended,
    sentFiles,
    unreferencedFiles,
    totalChars,
    estimatedTokens: estimateTokens(system) + estimateTokens(prompt),
    maxContextChars,
    overLimit,
    trimmed,
    resolved,
    fileIds: sentFiles.map((file) => file.id),
    hadFilePlaceholder,
  };
}

export type RetryInfo = { attempt: number; retryInMs: number; message: string };

export type RunHandlers = {
  signal: AbortSignal;
  onRetry?: (info: RetryInfo) => void;
};

export type RunJob = {
  prepared: PreparedRun;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
  customHeaders?: Record<string, string>;
};

export type SaveReply = (
  input: Omit<Reply, 'id' | 'createdAt' | 'status'> & { status?: Reply['status'] },
) => Promise<Reply>;

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new NudgeError('cancelled', 'The request was cancelled.'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new NudgeError('cancelled', 'The request was cancelled.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function executeRun(
  job: RunJob,
  handlers: RunHandlers,
  saveReply: SaveReply,
): Promise<{ reply: Reply; usage?: ModelUsage; latencyMs: number }> {
  const { prepared } = job;
  let lastError: NudgeError | null = null;
  const maxAttempts = Math.max(1, job.maxRetries + 1);

  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
    try {
      const result = await callModel({
        provider: prepared.resolved,
        apiKey: job.apiKey,
        system: prepared.system,
        user: prepared.prompt,
        customHeaders: job.customHeaders,
        timeoutMs: job.timeoutMs,
        signal: handlers.signal,
      });
      let reply: Reply;
      try {
        reply = await saveReply({
          documentId: prepared.documentId,
          nudgerId: prepared.nudgerId,
          text: result.text,
          resolvedPrompt: prepared.fullPrompt,
          fileIds: prepared.fileIds,
          model: prepared.resolved.model,
          provider: prepared.resolved.providerId,
          usage: result.usage,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new NudgeError('storage', `The reply arrived but could not be saved: ${detail}`);
      }
      return { reply, usage: result.usage, latencyMs: result.latencyMs };
    } catch (error) {
      const nudgeError = asNudgeError(error);
      lastError = nudgeError;
      if (nudgeError.kind === 'cancelled') throw nudgeError;
      const isLast = attemptIndex >= maxAttempts - 1;
      if (!nudgeError.retryable || isLast) throw nudgeError;

      const requestedWait = nudgeError.retryAfterMs ?? 2000 * (attemptIndex + 1);
      // Very long provider waits are surfaced instead of holding a card in limbo.
      if (requestedWait > 15_000) throw nudgeError;
      const retryInMs = Math.max(500, requestedWait);
      handlers.onRetry?.({
        attempt: attemptIndex + 2,
        retryInMs,
        message:
          nudgeError.kind === 'rate_limit'
            ? 'Rate limited by the provider. Waiting before retrying.'
            : 'The provider failed. Waiting before retrying.',
      });
      await delay(retryInMs, handlers.signal);
    }
  }
  throw lastError ?? new NudgeError('unknown', 'The run failed.');
}

export function prepareCustomHeaders(settings: Settings): Record<string, string> {
  return effectiveCustomHeaders(settings);
}
