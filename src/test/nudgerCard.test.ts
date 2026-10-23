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

function render(replies: Reply[], state?: RunState, onUpdate: (patch: { autoRun?: boolean }) => void = () => {}) {
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
          onUpdate,
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
    auto: host.querySelector('.auto-toggle'),
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
    expect(html).toContain('Dismissed — this nudger will not raise it again. Run for a different angle.');
    // The dismissed reply moves into history, newest first, so it can be
    // allowed again or copied; the older nudge is not promoted to the card.
    expect(history?.textContent).toContain('Dismissed nudge.');
    expect(history?.textContent).toContain('Older nudge.');
  });

  it('does not promise a replacement nudge while one happens to be running', () => {
    const { html } = render([makeReply('new', 2, 'Dismissed nudge.', 'dismissed')], running);
    expect(html).toContain('Dismissed — this nudger will not raise it again.');
    expect(html).not.toContain('calculating a new nudge');
  });

  it('says nothing was raised instead of inventing a nudge', () => {
    const quiet: RunState = {
      phase: 'quiet',
      nudgerId: nudger.id,
      documentId: nudger.documentId,
      startedAt: Date.now(),
    };
    const { html } = render([makeReply('new', 2, 'Rejected nudge.', 'dismissed')], quiet);
    expect(html).toContain('Nothing new to flag');
  });

  it('labels dismissal as a do-not-raise action', () => {
    const { history } = render([
      makeReply('new', 2, 'Newest nudge.'),
      makeReply('old', 1, 'Older nudge.'),
    ]);
    expect(history?.textContent).toContain('Don\u2019t raise this again');
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

describe('auto toggle', () => {
  it('reads auto and shows the nudger auto-run state next to Run', () => {
    const on = render([], undefined, () => {});
    const actions = host!.querySelector('.card-actions');
    expect(on.auto?.textContent?.trim()).toBe('auto');
    expect(on.auto?.getAttribute('aria-pressed')).toBe('true');
    expect(actions?.querySelector('.auto-toggle')).not.toBeNull();
    // It sits right after Run, before the other actions.
    const labels = Array.from(actions?.querySelectorAll('button:not(.menu-summary)') ?? []).map(
      (button) => button.textContent?.trim(),
    );
    expect(labels.slice(0, 3)).toEqual(['Run', 'auto', 'Preview']);
  });

  it('turns auto-run off from the card', () => {
    const patches: Array<{ autoRun?: boolean }> = [];
    render([], undefined, (patch) => patches.push(patch));
    act(() => {
      host!.querySelector<HTMLButtonElement>('.auto-toggle')!.click();
    });
    expect(patches).toEqual([{ autoRun: false }]);
  });

  it('renders as off when auto-run is off', () => {
    nudger.autoRun = false;
    try {
      const off = render([], undefined, () => {});
      expect(off.auto?.getAttribute('aria-pressed')).toBe('false');
      expect(off.auto?.querySelector('.auto-dot')).not.toBeNull();
    } finally {
      nudger.autoRun = true;
    }
  });
});
