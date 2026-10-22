import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeRun, prepareRun } from '../lib/run';
import { makeStore, newNudgerInput, testSettings } from './helpers';
import type { PreparedRun } from '../lib/run';

const active: Awaited<ReturnType<typeof makeStore>>[] = [];

async function freshStore() {
  const ctx = await makeStore();
  active.push(ctx);
  return ctx.store;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  while (active.length) {
    const ctx = active.pop();
    await ctx?.cleanup();
  }
});

function openAiReply(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function runPrepared(
  store: Awaited<ReturnType<typeof freshStore>>,
  prepared: PreparedRun,
  apiKey = 'test-key',
) {
  const controller = new AbortController();
  return executeRun(
    { prepared, apiKey, timeoutMs: 5000, maxRetries: 0 },
    { signal: controller.signal },
    async (input) => store.addReply(input),
  );
}

describe('mocked nudger run', () => {
  it('creates a document, attaches a file, resolves the prompt, calls the model and saves the reply', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('Cover letter', 'Dear team, I built a thing.');
    const notes = await store.createFile('notes.md', 'FACT: the thing served 1.2 million requests.');
    const nudger = await store.createNudger(
      newNudgerInput({
        name: 'Completeness coach',
        fileIds: [notes.id],
        prompt: 'Reference notes:\n{{files}}\n\nDraft:\n{{before_cursor}}',
      }),
    );

    const prepared = prepareRun({
      nudger,
      document: doc,
      caret: { start: doc.currentText.length, end: doc.currentText.length },
      files: [notes],
      settings: testSettings,
    });
    expect(prepared.blocking).toBe(false);
    expect(prepared.prompt).toContain('1.2 million requests');

    const fetchMock = vi.fn(async () => openAiReply('Which request count should the letter name?'));
    vi.stubGlobal('fetch', fetchMock);

    const { reply } = await runPrepared(store, prepared);
    expect(reply.text).toBe('Which request count should the letter name?');
    expect(reply.resolvedPrompt).toContain('REFERENCE FILE: notes.md');
    expect(reply.resolvedPrompt).toContain('Dear team, I built a thing.');
    expect(reply.fileIds).toEqual([notes.id]);
    expect(reply.model).toBe('deepseek-flash');
    expect(await store.listReplies(doc.id)).toHaveLength(1);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.messages[1].content).toContain('FACT: the thing served 1.2 million requests.');
    expect(body.messages[1].content).toContain('Dear team, I built a thing.');
  });

  it('keeps old resolved prompts unchanged when the reference file is edited', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('Essay', 'Draft text.');
    const notes = await store.createFile('notes.md', 'OLD FACT');
    const nudger = await store.createNudger(
      newNudgerInput({ fileIds: [notes.id], prompt: 'Notes:\n{{files}}\n\nDraft:\n{{before_cursor}}' }),
    );
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        return openAiReply(call === 1 ? 'First nudge' : 'Second nudge');
      }),
    );

    const firstPrepared = prepareRun({
      nudger,
      document: doc,
      caret: { start: doc.currentText.length, end: doc.currentText.length },
      files: [(await store.getFile(notes.id))!],
      settings: testSettings,
    });
    await runPrepared(store, firstPrepared);
    const firstReply = (await store.listReplies(doc.id))[0];
    expect(firstReply.resolvedPrompt).toContain('OLD FACT');

    await store.updateFile(notes.id, { content: 'NEW FACT' });
    const updatedFile = await store.getFile(notes.id);
    const secondPrepared = prepareRun({
      nudger,
      document: doc,
      caret: { start: doc.currentText.length, end: doc.currentText.length },
      files: [updatedFile!],
      settings: testSettings,
    });
    await runPrepared(store, secondPrepared);

    const replies = await store.listReplies(doc.id);
    expect(replies).toHaveLength(2);
    const oldReply = replies.find((r) => r.text === 'First nudge');
    const newReply = replies.find((r) => r.text === 'Second nudge');
    expect(oldReply?.resolvedPrompt).toContain('OLD FACT');
    expect(oldReply?.resolvedPrompt).not.toContain('NEW FACT');
    expect(newReply?.resolvedPrompt).toContain('NEW FACT');
  });

  it('retries a rate-limited request with backoff', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('Doc', 'Text');
    const nudger = await store.createNudger(newNudgerInput());
    const prepared = prepareRun({
      nudger,
      document: doc,
      caret: { start: 0, end: 0 },
      files: [],
      settings: testSettings,
    });

    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '0' },
          });
        }
        return openAiReply('After the wait');
      }),
    );

    const retries: number[] = [];
    const controller = new AbortController();
    const { reply } = await executeRun(
      { prepared, apiKey: 'k', timeoutMs: 5000, maxRetries: 1 },
      {
        signal: controller.signal,
        onRetry: (info) => retries.push(info.attempt),
      },
      async (input) => store.addReply(input),
    );
    expect(calls).toBe(2);
    expect(retries).toEqual([2]);
    expect(reply.text).toBe('After the wait');
  });

  it('can be cancelled without saving a reply', async () => {
    const store = await freshStore();
    const doc = await store.createDocument('Doc', 'Text');
    const nudger = await store.createNudger(newNudgerInput());
    const prepared = prepareRun({
      nudger,
      document: doc,
      caret: { start: 0, end: 0 },
      files: [],
      settings: testSettings,
    });
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
    const controller = new AbortController();
    const running = executeRun(
      { prepared, apiKey: 'k', timeoutMs: 5000, maxRetries: 0 },
      { signal: controller.signal },
      async (input) => store.addReply(input),
    );
    setTimeout(() => controller.abort(), 20);
    await expect(running).rejects.toMatchObject({ kind: 'cancelled' });
    expect(await store.listReplies(doc.id)).toHaveLength(0);
  });
});
