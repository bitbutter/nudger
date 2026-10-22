import { NudgerDB } from '../lib/db';
import { createStore } from '../lib/storage';
import type { Nudger, ReferenceFile } from '../types';
import { DEFAULT_SETTINGS } from '../lib/defaults';

let counter = 0;

export async function makeStore() {
  counter += 1;
  const name = `nudger-test-${counter}-${Math.random().toString(36).slice(2, 8)}`;
  const database = new NudgerDB(name);
  const store = createStore(database);
  return {
    database,
    store,
    async cleanup() {
      database.close();
      await database.delete();
    },
  };
}

export function testFile(name: string, content: string): ReferenceFile {
  const now = Date.now();
  return {
    id: `file-${name}`,
    name,
    kind: name.endsWith('.md') ? 'md' : 'txt',
    content,
    createdAt: now,
    updatedAt: now,
    wordCount: content.trim() ? content.trim().split(/\s+/).length : 0,
  };
}

export function testNudger(partial: Partial<Nudger> = {}): Nudger {
  const now = Date.now();
  return {
    id: 'nudger-1',
    name: 'Coach',
    description: '',
    color: '#7aa2f7',
    system: 'You are a coach. Do not rewrite.',
    prompt: 'Draft:\n{{before_cursor}}',
    fileIds: [],
    temperature: 0.2,
    maxTokens: 400,
    maxContextChars: 100_000,
    autoRun: false,
    enabled: true,
    done: false,
    budget: 3,
    order: 0,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export const testSettings = {
  ...DEFAULT_SETTINGS,
  apiKey: 'test-key',
};

export function newNudgerInput(partial: Partial<Nudger> = {}) {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, order, ...rest } = testNudger(partial);
  void _id;
  void _createdAt;
  void _updatedAt;
  return partial.order === undefined ? rest : { ...rest, order };
}

export function testReplyInput(documentId: string, nudgerId: string, text = 'A nudge') {
  return {
    documentId,
    nudgerId,
    text,
    resolvedPrompt: '=== USER ===\nDraft',
    fileIds: [],
    model: 'test-model',
    provider: 'deepseek',
  };
}
