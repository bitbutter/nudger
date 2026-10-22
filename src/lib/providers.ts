import type { Nudger, ProviderId } from '../types';
import { NudgeError } from './errors';

export type ProviderKind = 'openai' | 'anthropic';
export type CorsState = 'verified' | 'unknown' | 'custom';

export type ProviderPreset = {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  /** Suggested API root. The adapter appends /chat/completions or /v1/messages. */
  baseUrl: string;
  defaultModel: string;
  modelHint: string;
  notes: string;
  docsUrl: string;
  cors: CorsState;
};

/**
 * CORS notes verified 2026-10-22 with OPTIONS preflight requests from a
 * browser-style Origin. Providers change this without notice; the app reports
 * a network error rather than pretending the request was sent.
 *
 * Endpoints that do not answer the browser preflight cannot be used from a
 * static page; the app reports a clear CORS error instead of hiding it.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
    modelHint: 'deepseek-flash · deepseek-v4-pro',
    notes: 'Pay-as-you-go API. Verified to allow direct browser requests (Oct 2026).',
    docsUrl: 'https://api-docs.deepseek.com/',
    cors: 'verified',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    modelHint: 'gpt-4o-mini · gpt-4.1-mini · any chat model on your account',
    notes: 'Verified to allow direct browser requests (Oct 2026).',
    docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
    cors: 'verified',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-5',
    modelHint: 'claude-sonnet-4-5 · claude-opus-4-1 · any model on your account',
    notes: 'Browser calls work because the app sends Anthropic’s direct-browser-access header.',
    docsUrl: 'https://docs.anthropic.com/en/api/messages',
    cors: 'verified',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    modelHint: 'provider/model, e.g. openai/gpt-4o-mini',
    notes: 'Verified to allow direct browser requests (Oct 2026). One key for many models.',
    docsUrl: 'https://openrouter.ai/docs',
    cors: 'verified',
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    modelHint: 'llama-3.3-70b-versatile · see your Groq model list',
    notes: 'Verified to allow direct browser requests (Oct 2026).',
    docsUrl: 'https://console.groq.com/docs/api-reference',
    cors: 'verified',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    modelHint: 'mistral-small-latest · mistral-large-latest',
    notes: 'Verified to allow direct browser requests (Oct 2026).',
    docsUrl: 'https://docs.mistral.ai/api/',
    cors: 'verified',
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible',
    kind: 'openai',
    baseUrl: '',
    defaultModel: '',
    modelHint: 'The model id your endpoint expects',
    notes: 'Any endpoint implementing POST /chat/completions. It must allow browser requests.',
    docsUrl: '',
    cors: 'unknown',
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible + headers)',
    kind: 'openai',
    baseUrl: '',
    defaultModel: '',
    modelHint: 'The model id your endpoint expects',
    notes: 'Point at your own endpoint. Add auth or routing headers under Custom headers.',
    docsUrl: '',
    cors: 'custom',
  },
];

export function getProviderPreset(id: ProviderId): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[0];
}

export function providerLabel(id: ProviderId): string {
  return getProviderPreset(id).label;
}

export type ResolvedProvider = {
  providerId: ProviderId;
  preset: ProviderPreset;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
};

/** Applies a per-nudger provider/model override on top of global settings. */
export function resolveProviderConfig(
  settings: {
    providerId: ProviderId;
    model: string;
    baseUrl: string;
    temperature: number;
    maxTokens: number;
  },
  nudger?: Pick<Nudger, 'providerId' | 'model' | 'temperature' | 'maxTokens'>,
): ResolvedProvider {
  const providerId = nudger?.providerId ?? settings.providerId;
  const preset = getProviderPreset(providerId);
  const sameProvider = providerId === settings.providerId;
  const baseUrl = (sameProvider ? settings.baseUrl : preset.baseUrl).trim() || preset.baseUrl;
  const model = (
    (nudger?.model ?? '').trim() ||
    (sameProvider ? settings.model.trim() : '') ||
    preset.defaultModel
  ).trim();
  return {
    providerId,
    preset,
    kind: preset.kind,
    baseUrl,
    model,
    temperature: nudger?.temperature ?? settings.temperature,
    maxTokens: nudger?.maxTokens ?? settings.maxTokens,
  };
}

export function openAiUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
}

export function anthropicUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (/\/messages$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/messages`;
  return `${base}/v1/messages`;
}

export function parseCustomHeaders(text: string | undefined): Record<string, string> {
  if (!text || !text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new NudgeError('config', 'Custom headers must be valid JSON, for example {"X-Client":"nudger"}.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new NudgeError('config', 'Custom headers must be a JSON object of string values.');
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new NudgeError('config', `Custom header "${key}" must have a string value.`);
    }
    out[key] = value;
  }
  return out;
}

export function effectiveCustomHeaders(
  settings: { customHeaders?: Record<string, string> },
): Record<string, string> {
  const headers = settings.customHeaders ?? {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!key.trim()) continue;
    out[key.trim()] = value;
  }
  return out;
}

export type ModelCallInput = {
  provider: ResolvedProvider;
  apiKey: string;
  system: string;
  user: string;
  customHeaders?: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type ModelUsage = { inputTokens?: number; outputTokens?: number };

export type ModelCallResult = {
  text: string;
  usage?: ModelUsage;
  latencyMs: number;
  rawModel?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractErrorMessage(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '(empty response body)';
  try {
    const data = JSON.parse(trimmed);
    if (isRecord(data)) {
      const error = data.error;
      if (isRecord(error) && typeof error.message === 'string') return error.message;
      if (typeof data.message === 'string') return data.message;
      if (typeof error === 'string') return error;
      if (typeof data.detail === 'string') return data.detail;
      if (typeof data.type === 'string' && typeof data.message !== 'string') {
        return `provider error type: ${data.type}`;
      }
    }
  } catch {
    // Fall through to the plain-text slice.
  }
  return trimmed.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 400);
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function classifyHttpError(
  status: number,
  body: string,
  retryAfterHeader: string | null,
): NudgeError {
  const detail = extractErrorMessage(body);
  const lower = detail.toLowerCase();
  const contextLike =
    /context (window|length)|maximum context|too many tokens|prompt is too long|input is too long|exceeds? the (model|maximum)/i.test(
      lower,
    );

  if (status === 401 || status === 403) {
    return new NudgeError(
      'auth',
      `The provider rejected the API key (HTTP ${status}). Open Settings, check the key for this provider, then use Test connection.`,
      { status, detail },
    );
  }
  if (status === 429) {
    return new NudgeError('rate_limit', 'The provider rate-limited this request (HTTP 429).', {
      status,
      detail,
      retryable: true,
      retryAfterMs: parseRetryAfter(retryAfterHeader) ?? 3000,
    });
  }
  if (status === 408 || status === 504) {
    return new NudgeError('timeout', `The provider timed out (HTTP ${status}). Try again or raise the request timeout.`, {
      status,
      detail,
      retryable: true,
      retryAfterMs: 2000,
    });
  }
  if (status === 400 || status === 413 || status === 422) {
    if (contextLike) {
      return new NudgeError(
        'context',
        'The resolved prompt is larger than the model accepts. Reduce the document text or attached files, or raise the per-nudger max context characters if the model supports it.',
        { status, detail },
      );
    }
    return new NudgeError('bad_request', `The provider rejected the request (HTTP ${status}): ${detail}`, {
      status,
      detail,
    });
  }
  if (status >= 500) {
    return new NudgeError('server', `The provider had a server error (HTTP ${status}). It will be retried once.`, {
      status,
      detail,
      retryable: true,
      retryAfterMs: 2000,
    });
  }
  return new NudgeError('bad_request', `The provider returned HTTP ${status}: ${detail}`, { status, detail });
}

function readOpenAiText(data: unknown): string {
  if (!isRecord(data)) return '';
  const choices = data.choices;
  if (!Array.isArray(choices) || !choices.length) return '';
  const first = choices[0];
  if (!isRecord(first)) return '';
  const message = first.message;
  if (isRecord(message)) {
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (isRecord(part) && typeof part.text === 'string') return part.text;
          return '';
        })
        .join('');
    }
  }
  if (typeof first.text === 'string') return first.text;
  return '';
}

function readAnthropicText(data: unknown): string {
  if (!isRecord(data)) return '';
  const content = data.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') return part.text;
      return '';
    })
    .join('');
}

function readUsage(data: unknown, kind: ProviderKind): ModelUsage | undefined {
  if (!isRecord(data)) return undefined;
  const usage = data.usage;
  if (!isRecord(usage)) return undefined;
  if (kind === 'anthropic') {
    return {
      inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
      outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
    };
  }
  return {
    inputTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
    outputTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
  };
}

function readRawModel(data: unknown): string | undefined {
  return isRecord(data) && typeof data.model === 'string' ? data.model : undefined;
}

export async function callModel(input: ModelCallInput): Promise<ModelCallResult> {
  const { provider, apiKey } = input;
  const key = apiKey.trim();
  if (!key) {
    throw new NudgeError('config', 'No API key set. Open Settings and paste a key for this provider.');
  }
  if (!provider.model) {
    throw new NudgeError('config', 'No model set. Open Settings or the nudger editor and enter a model id.');
  }
  let baseUrl = provider.baseUrl.trim();
  if (!baseUrl) {
    throw new NudgeError('config', 'No base URL set. Open Settings and enter the provider API URL.');
  }
  if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `https://${baseUrl}`;

  const customHeaders = { ...(input.customHeaders ?? {}) };
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...customHeaders,
  };

  let url: string;
  let body: Record<string, unknown>;
  if (provider.kind === 'anthropic') {
    url = anthropicUrl(baseUrl);
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
    body = {
      model: provider.model,
      max_tokens: provider.maxTokens,
      temperature: provider.temperature,
      messages: [{ role: 'user', content: input.user }],
      ...(input.system.trim() ? { system: input.system } : {}),
    };
  } else {
    url = openAiUrl(baseUrl);
    headers.authorization = `Bearer ${key}`;
    body = {
      model: provider.model,
      messages: [
        ...(input.system.trim() ? [{ role: 'system', content: input.system }] : []),
        { role: 'user', content: input.user },
      ],
      temperature: provider.temperature,
      max_tokens: provider.maxTokens,
      stream: false,
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, input.timeoutMs);
  const onOuterAbort = () => controller.abort();
  if (input.signal) {
    if (input.signal.aborted) controller.abort();
    else input.signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  const started = Date.now();
  let response!: Response;
  let raw!: string;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      credentials: 'omit',
      mode: 'cors',
    });
    // Keep the timeout and cancel signal active until the body is fully read.
    raw = await response.text();
  } catch (error) {
    if (timedOut) {
      throw new NudgeError(
        'timeout',
        `No response from ${provider.preset.label} within ${Math.round(input.timeoutMs / 1000)} seconds. Check the network, or raise the request timeout in Settings.`,
      );
    }
    if (input.signal?.aborted) {
      throw new NudgeError('cancelled', 'The request was cancelled.');
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new NudgeError(
      'cors',
      `The browser could not reach ${provider.preset.label} at ${url}. This is usually a CORS block or a network problem. ${provider.preset.cors === 'verified' ? 'This provider normally allows browser requests, so check your connection and the base URL.' : 'This endpoint must send CORS headers to allow browser requests.'} You can also use DeepSeek, OpenAI, Anthropic, OpenRouter, Groq or Mistral directly.`,
      { detail },
    );
  } finally {
    clearTimeout(timer);
    if (input.signal) input.signal.removeEventListener('abort', onOuterAbort);
  }

  if (!response.ok) {
    throw classifyHttpError(response.status, raw, response.headers.get('retry-after'));
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new NudgeError('bad_request', 'The provider returned a non-JSON response. Check the base URL and model.', {
      status: response.status,
      detail: raw.slice(0, 300),
    });
  }
  if (isRecord(data) && data.error) {
    throw new NudgeError('bad_request', `The provider returned an error: ${extractErrorMessage(raw)}`, {
      status: response.status,
      detail: extractErrorMessage(raw),
    });
  }

  const text = (provider.kind === 'anthropic' ? readAnthropicText(data) : readOpenAiText(data)).trim();
  if (!text) {
    throw new NudgeError(
      'empty',
      'The provider returned an empty reply. Try again, or check that the model id is a chat model.',
      { detail: raw.slice(0, 300) },
    );
  }

  return {
    text,
    usage: readUsage(data, provider.kind),
    latencyMs: Date.now() - started,
    rawModel: readRawModel(data),
  };
}

export async function testProviderConnection(input: ModelCallInput): Promise<ModelCallResult> {
  return callModel({
    ...input,
    system: 'You are a connection test. Follow the instruction exactly.',
    user: 'Reply with the single word: ok',
    timeoutMs: Math.min(input.timeoutMs, 30000),
  });
}
