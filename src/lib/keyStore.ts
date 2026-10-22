const LOCAL_KEY = 'nudger.apiKey.local';
const SESSION_KEY = 'nudger.apiKey.session';

function safeGet(storage: Storage | undefined, name: string): string {
  try {
    return storage?.getItem(name) ?? '';
  } catch {
    return '';
  }
}

function safeSet(storage: Storage | undefined, name: string, value: string): void {
  try {
    storage?.setItem(name, value);
  } catch {
    // Storage can be unavailable in private modes. The key stays in memory.
  }
}

function safeRemove(storage: Storage | undefined, name: string): void {
  try {
    storage?.removeItem(name);
  } catch {
    // ignore
  }
}

function session(): Storage | undefined {
  return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
}

function local(): Storage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

export type LoadedKey = { key: string; source: 'local' | 'session' | 'none' };

/**
 * "Remember key" decides which store is authoritative. When it is off, any
 * leftover localStorage key is removed rather than silently used.
 */
export function loadApiKey(remember: boolean): LoadedKey {
  const sessionKey = safeGet(session(), SESSION_KEY);
  const localKey = safeGet(local(), LOCAL_KEY);
  // Loading never moves or deletes a key. Only an explicit save/clear does that.
  if (remember && localKey) return { key: localKey, source: 'local' };
  if (remember && sessionKey) return { key: sessionKey, source: 'session' };
  if (!remember && sessionKey) return { key: sessionKey, source: 'session' };
  return { key: '', source: 'none' };
}

export function saveApiKey(key: string, remember: boolean): void {
  const trimmed = key.trim();
  safeRemove(local(), LOCAL_KEY);
  safeRemove(session(), SESSION_KEY);
  if (!trimmed) return;
  if (remember) safeSet(local(), LOCAL_KEY, trimmed);
  else safeSet(session(), SESSION_KEY, trimmed);
}

export function clearApiKey(): void {
  safeRemove(local(), LOCAL_KEY);
  safeRemove(session(), SESSION_KEY);
}

export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return 'No key set';
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)} (${trimmed.length} chars)`;
}
