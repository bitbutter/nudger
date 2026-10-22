import type { ProviderId, Settings, Theme, Layout } from '../types';
import { getProviderPreset, PROVIDER_PRESETS } from './providers';
import { clamp } from './util';

export const DEFAULT_SETTINGS: Settings = {
  providerId: 'deepseek',
  model: getProviderPreset('deepseek').defaultModel,
  baseUrl: getProviderPreset('deepseek').baseUrl,
  rememberKey: false,
  temperature: 0.4,
  maxTokens: 700,
  maxContextChars: 100_000,
  autoRunDelayMs: 1500,
  maxConcurrentRuns: 2,
  requestTimeoutMs: 60_000,
  theme: 'dark',
  layout: 'stacked',
};

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && PROVIDER_PRESETS.some((p) => p.id === value);
}

function numberOr(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

/** Merges persisted/imported settings with defaults and drops any key. */
export function normalizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const source = raw ?? {};
  const providerId = isProviderId(source.providerId) ? source.providerId : DEFAULT_SETTINGS.providerId;
  const preset = getProviderPreset(providerId);
  const theme: Theme = source.theme === 'light' ? 'light' : 'dark';
  const layout: Layout = source.layout === 'side' ? 'side' : 'stacked';
  const customHeaders =
    source.customHeaders && typeof source.customHeaders === 'object' && !Array.isArray(source.customHeaders)
      ? Object.fromEntries(
          Object.entries(source.customHeaders).filter((entry): entry is [string, string] => {
            return typeof entry[1] === 'string';
          }),
        )
      : undefined;
  return {
    providerId,
    model: typeof source.model === 'string' && source.model.trim() ? source.model.trim() : preset.defaultModel,
    baseUrl:
      typeof source.baseUrl === 'string' && source.baseUrl.trim() ? source.baseUrl.trim() : preset.baseUrl,
    rememberKey: Boolean(source.rememberKey),
    temperature: numberOr(source.temperature, DEFAULT_SETTINGS.temperature, 0, 2),
    maxTokens: Math.round(numberOr(source.maxTokens, DEFAULT_SETTINGS.maxTokens, 1, 64_000)),
    maxContextChars: Math.round(
      numberOr(source.maxContextChars, DEFAULT_SETTINGS.maxContextChars, 1_000, 2_000_000),
    ),
    autoRunDelayMs: Math.round(
      numberOr(source.autoRunDelayMs, DEFAULT_SETTINGS.autoRunDelayMs, 250, 60_000),
    ),
    maxConcurrentRuns: Math.round(
      numberOr(source.maxConcurrentRuns, DEFAULT_SETTINGS.maxConcurrentRuns, 1, 8),
    ),
    requestTimeoutMs: Math.round(
      numberOr(source.requestTimeoutMs, DEFAULT_SETTINGS.requestTimeoutMs, 5_000, 300_000),
    ),
    theme,
    layout,
    customHeaders: customHeaders && Object.keys(customHeaders).length ? customHeaders : undefined,
  };
}

/** Settings as stored on disk and exported. Never contains a key. */
export type StoredSettings = Omit<Settings, 'apiKey'>;

export function stripApiKey(settings: Settings): StoredSettings {
  const { apiKey: _apiKey, ...rest } = settings;
  return rest;
}
