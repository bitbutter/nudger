import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  anthropicUrl,
  callModel,
  getProviderPreset,
  openAiUrl,
  parseCustomHeaders,
  resolveProviderConfig,
} from '../lib/providers';
import { DEFAULT_SETTINGS } from '../lib/defaults';
import { NudgeError } from '../lib/errors';

const provider = resolveProviderConfig(DEFAULT_SETTINGS);

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('provider configuration', () => {
  it('defaults to DeepSeek pay-as-you-go', () => {
    expect(DEFAULT_SETTINGS.providerId).toBe('deepseek');
    expect(DEFAULT_SETTINGS.baseUrl).toBe('https://api.deepseek.com');
    expect(DEFAULT_SETTINGS.model).toBe('deepseek-flash');
    expect(getProviderPreset('deepseek').cors).toBe('verified');
  });

  it('only advertises browser-safe presets', () => {
    for (const id of ['deepseek', 'openai', 'anthropic', 'openrouter', 'groq', 'mistral'] as const) {
      expect(getProviderPreset(id).cors).toBe('verified');
    }
  });

  it('applies a per-nudger provider and model override', () => {
    const resolved = resolveProviderConfig(DEFAULT_SETTINGS, {
      providerId: 'openrouter',
      model: 'anthropic/claude-sonnet-4.5',
      temperature: 0.9,
      maxTokens: 123,
    });
    expect(resolved.providerId).toBe('openrouter');
    expect(resolved.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(resolved.model).toBe('anthropic/claude-sonnet-4.5');
    expect(resolved.temperature).toBe(0.9);
    expect(resolved.maxTokens).toBe(123);
    expect(resolved.preset.kind).toBe('openai');
  });

  it('uses the preset model when a nudger changes provider without a model', () => {
    const resolved = resolveProviderConfig(DEFAULT_SETTINGS, {
      providerId: 'anthropic',
      model: '',
      temperature: 0.4,
      maxTokens: 700,
    });
    expect(resolved.model).toBe(getProviderPreset('anthropic').defaultModel);
    expect(resolved.baseUrl).toBe(getProviderPreset('anthropic').baseUrl);

    const same = resolveProviderConfig(DEFAULT_SETTINGS, {
      providerId: 'deepseek',
      model: '',
      temperature: 0.4,
      maxTokens: 700,
    });
    expect(same.model).toBe(DEFAULT_SETTINGS.model);
  });

  it('builds endpoint URLs without duplicating path segments', () => {
    expect(openAiUrl('https://api.deepseek.com')).toBe('https://api.deepseek.com/chat/completions');
    expect(openAiUrl('https://api.deepseek.com/')).toBe('https://api.deepseek.com/chat/completions');
    expect(openAiUrl('https://api.deepseek.com/chat/completions')).toBe(
      'https://api.deepseek.com/chat/completions',
    );
    expect(anthropicUrl('https://api.anthropic.com')).toBe('https://api.anthropic.com/v1/messages');
    expect(anthropicUrl('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com/v1/messages');
    expect(anthropicUrl('https://api.anthropic.com/v1/messages')).toBe(
      'https://api.anthropic.com/v1/messages',
    );
  });

  it('validates custom header JSON', () => {
    expect(parseCustomHeaders('')).toEqual({});
    expect(parseCustomHeaders('{"X-Client":"nudger"}')).toEqual({ 'X-Client': 'nudger' });
    expect(() => parseCustomHeaders('[]')).toThrow(NudgeError);
    expect(() => parseCustomHeaders('{"X-N":2}')).toThrow(/string value/);
    expect(() => parseCustomHeaders('{nope}')).toThrow(/valid JSON/);
  });
});

describe('provider requests', () => {
  it('sends an OpenAI-compatible request to DeepSeek', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: ' hello ' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await callModel({
      provider,
      apiKey: 'sk-deepseek-test',
      system: 'Be brief.',
      user: 'Draft text',
      timeoutMs: 5000,
    });
    expect(result.text).toBe('hello');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-deepseek-test');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('deepseek-flash');
    expect(body.messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Draft text' },
    ]);
    expect(body.max_tokens).toBe(DEFAULT_SETTINGS.maxTokens);
    expect(body.stream).toBe(false);
  });

  it('sends the Anthropic shape with the direct-browser-access header', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        content: [{ type: 'text', text: 'looks fine' }],
        usage: { input_tokens: 11, output_tokens: 3 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const anthropic = resolveProviderConfig({
      ...DEFAULT_SETTINGS,
      providerId: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
    });
    const result = await callModel({
      provider: anthropic,
      apiKey: 'sk-ant-test',
      system: 'You are a reviewer.',
      user: 'Draft text',
      timeoutMs: 5000,
    });
    expect(result.text).toBe('looks fine');
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 3 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(headers.authorization).toBeUndefined();
    const body = JSON.parse(String(init.body));
    expect(body.system).toBe('You are a reviewer.');
    expect(body.messages).toEqual([{ role: 'user', content: 'Draft text' }]);
    expect(body.max_tokens).toBe(DEFAULT_SETTINGS.maxTokens);
  });

  it('sends custom headers for OpenAI-compatible endpoints', async () => {
    let captured: Record<string, string> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        captured = init.headers as Record<string, string>;
        return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
      }),
    );
    const custom = resolveProviderConfig({
      ...DEFAULT_SETTINGS,
      providerId: 'openai-compatible',
      baseUrl: 'https://example.test/v1',
      model: 'local-model',
    });
    await callModel({
      provider: custom,
      apiKey: 'key-123',
      system: '',
      user: 'Hi',
      customHeaders: { 'X-Client': 'nudger' },
      timeoutMs: 5000,
    });
    expect(captured['X-Client']).toBe('nudger');
    expect(captured.authorization).toBe('Bearer key-123');
  });
});

describe('provider errors', () => {
  it('classifies an invalid key and does not echo the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { message: 'Incorrect API key provided' } }, 401)),
    );
    await expect(
      callModel({ provider, apiKey: 'sk-too-secret', system: '', user: 'Hi', timeoutMs: 5000 }),
    ).rejects.toMatchObject({ kind: 'auth', status: 401 });
    try {
      await callModel({ provider, apiKey: 'sk-too-secret', system: '', user: 'Hi', timeoutMs: 5000 });
    } catch (error) {
      expect((error as Error).message).not.toContain('sk-too-secret');
      expect((error as Error).message).toContain('Settings');
    }
  });

  it('classifies rate limits with retry-after', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { message: 'slow down' } }, 429, { 'retry-after': '2' }),
      ),
    );
    await expect(
      callModel({ provider, apiKey: 'k', system: '', user: 'Hi', timeoutMs: 5000 }),
    ).rejects.toMatchObject({ kind: 'rate_limit', retryable: true, retryAfterMs: 2000 });
  });

  it('recognises a context-window error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { message: "This model's maximum context length is 8192 tokens" } }, 400),
      ),
    );
    await expect(
      callModel({ provider, apiKey: 'k', system: '', user: 'Hi', timeoutMs: 5000 }),
    ).rejects.toMatchObject({ kind: 'context' });
  });

  it('explains a CORS or network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(
      callModel({ provider, apiKey: 'k', system: '', user: 'Hi', timeoutMs: 5000 }),
    ).rejects.toMatchObject({ kind: 'cors' });
    try {
      await callModel({ provider, apiKey: 'k', system: '', user: 'Hi', timeoutMs: 5000 });
    } catch (error) {
      expect((error as Error).message).toContain('CORS');
      expect((error as Error).message).toContain('DeepSeek');
    }
  });

  it('times out with an actionable message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      ),
    );
    await expect(
      callModel({ provider, apiKey: 'k', system: '', user: 'Hi', timeoutMs: 40 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('refuses to call without a key or model', async () => {
    await expect(
      callModel({ provider, apiKey: '', system: '', user: 'Hi', timeoutMs: 5000 }),
    ).rejects.toMatchObject({ kind: 'config' });
    const noModel = { ...provider, model: '' };
    await expect(
      callModel({ provider: noModel, apiKey: 'k', system: '', user: 'Hi', timeoutMs: 5000 }),
    ).rejects.toMatchObject({ kind: 'config' });
  });
});
