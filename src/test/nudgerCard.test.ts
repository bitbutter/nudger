// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { NudgerCard } from '../components/NudgerCard';
import { ToastProvider } from '../components/Toast';
import type { RunState } from '../lib/runManager';
import type { Reply } from '../types';
import { testNudger } from './helpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nudger = testNudger({ id: 'nudger-1', name: 'Coach', autoRun: true });

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = '';
});

function makeReply(id: string, createdAt: number, text: string, status: Reply['status'] = 'new'): Reply {
  return {
    id,
    documentId: nudger.documentId,
    nudgerId: nudger.id,
    text,
    resolvedPrompt: '',
    fileIds: [],
    model: 'test-model',
    provider: 'deepseek',
    createdAt,
    status,
  };
}

function render(replies: Reply[], state?: RunState) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      createElement(
        ToastProvider,
        null,
        createElement(NudgerCard, {
          nudger,
          index: 0,
          total: 1,
          fileCount: 0,
          onOpenFiles: () => {},
          replies,
          state,
          focused: false,
          hasKey: true,
          onFocus: () => {},
          onRun: () => {},
          onCancel: () => {},
          onPreview: () => {},
          onEdit: () => {},
          onDuplicate: () => {},
          onSaveAsTemplate: () => {},
          onDelete: () => {},
          onMove: () => {},
          onUpdate: () => {},
          onClearHistory: () => {},
          onReplyStatus: () => {},
          onRetry: () => {},
          onOpenSettings: () => {},
        }),
      ),
    );
  });
  return {
    html: host.innerHTML,
    main: host.querySelector('.card-reply > article.reply'),
    history: host.querySelector('.reply-history'),
  };
}

const running: RunState = {
  phase: 'running',
  nudgerId: nudger.id,
  documentId: nudger.documentId,
  startedAt: Date.now(),
};

describe('nudger card reply slot', () => {
  it('shows the newest reply', () => {
    const { main } = render([
      makeReply('new', 2, 'Newest nudge.'),
      makeReply('old', 1, 'Older nudge.'),
    ]);
    expect(main?.textContent).toContain('Newest nudge.');
  });

  it('never falls back to an older nudge when the newest one is dismissed', () => {
    const { main, history, html } = render([
      makeReply('new', 2, 'Dismissed nudge.', 'dismissed'),
      makeReply('old', 1, 'Older nudge.'),
    ]);
    expect(main).toBeNull();
    expect(html).toContain('Dismissed. Run to calculate a new nudge.');
    // The dismissed reply moves into history, newest first, so it can be
    // undismissed or copied; the older nudge is not promoted to the card.
    expect(history?.textContent).toContain('Dismissed nudge.');
    expect(history?.textContent).toContain('Older nudge.');
  });

  it('says a new nudge is being calculated while the replacement runs', () => {
    const { html } = render([makeReply('new', 2, 'Dismissed nudge.', 'dismissed')], running);
    expect(html).toContain('Dismissed — calculating a new nudge');
  });

  it('explains an archived newest reply and keeps it in history', () => {
    const { main, history, html } = render([
      makeReply('new', 2, 'Archived nudge.', 'archived'),
      makeReply('old', 1, 'Older nudge.'),
    ]);
    expect(main).toBeNull();
    expect(html).toContain('Archived — the reply stays in History.');
    expect(history?.textContent).toContain('Archived nudge.');
  });

  it('shows a pinned newest reply', () => {
    const { main } = render([makeReply('new', 2, 'Pinned nudge.', 'pinned')]);
    expect(main?.textContent).toContain('Pinned nudge.');
  });
});
