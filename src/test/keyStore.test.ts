import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearApiKey, loadApiKey, saveApiKey } from '../lib/keyStore';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  } as Storage;
}

const local = memoryStorage();
const session = memoryStorage();
vi.stubGlobal('localStorage', local);
vi.stubGlobal('sessionStorage', session);

afterEach(() => {
  clearApiKey();
});

describe('API key storage', () => {
  it('remembers a key only in localStorage when asked', () => {
    saveApiKey('sk-remembered', true);
    expect(local.getItem('nudger.apiKey.local')).toBe('sk-remembered');
    expect(session.getItem('nudger.apiKey.session')).toBeNull();
    expect(loadApiKey(true)).toEqual({ key: 'sk-remembered', source: 'local' });
  });

  it('keeps a session key in sessionStorage when remembering is off', () => {
    saveApiKey('sk-session', false);
    expect(session.getItem('nudger.apiKey.session')).toBe('sk-session');
    expect(local.getItem('nudger.apiKey.local')).toBeNull();
    expect(loadApiKey(false)).toEqual({ key: 'sk-session', source: 'session' });
  });

  it('loading does not move or delete a remembered key when remember is off', () => {
    saveApiKey('sk-remembered', true);
    expect(loadApiKey(false)).toEqual({ key: '', source: 'none' });
    expect(local.getItem('nudger.apiKey.local')).toBe('sk-remembered');
  });

  it('clears both stores', () => {
    saveApiKey('sk-a', true);
    saveApiKey('sk-b', false);
    clearApiKey();
    expect(loadApiKey(true).key).toBe('');
    expect(loadApiKey(false).key).toBe('');
  });
});
