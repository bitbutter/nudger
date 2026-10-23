// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { NudgerBoard } from '../components/NudgerBoard';
import { ToastProvider } from '../components/Toast';
import { testNudger } from './helpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = '';
});

function render(selectionWords: number) {
  const nudger = testNudger({ id: 'nudger-1', name: 'Coach', autoRun: false });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      createElement(
        ToastProvider,
        null,
        createElement(NudgerBoard, {
          nudgers: [nudger],
          files: [],
          replies: [],
          templates: [],
          runStates: {},
          documentId: nudger.documentId,
          selectionWords,
          focusedNudgerId: null,
          hasKey: true,
          onFocusNudger: () => {},
          onRunNudger: () => {},
          onCancelNudger: () => {},
          onRunAll: () => {},
          onAddNudger: () => {},
          onEditNudger: () => {},
          onPreviewNudger: () => {},
          onDuplicateNudger: () => {},
          onSaveNudgerAsTemplate: () => {},
          onDeleteNudger: () => {},
          onMoveNudger: () => {},
          onUpdateNudger: () => {},
          onClearHistory: () => {},
          onReplyStatus: () => {},
          onRetryNudger: () => {},
          onAddFromTemplate: () => {},
          onOpenSettings: () => {},
          onOpenFiles: () => {},
        }),
      ),
    );
  });
  return {
    scope: host.querySelector('.board-scope'),
    runAll: host.querySelector('.section-actions button'),
  };
}

describe('board scope notice', () => {
  it('says nothing when there is no selection', () => {
    const { scope, runAll } = render(0);
    expect(scope).toBeNull();
    expect(runAll?.getAttribute('title')).toBe('Run all enabled nudgers (Ctrl+Shift+Enter)');
  });

  it('states that running reads the selection', () => {
    const { scope, runAll } = render(24);
    expect(scope?.textContent).toContain('Running reads your selection (24 words), not the whole draft.');
    expect(scope?.textContent).toContain('Clear the selection to read everything.');
    expect(runAll?.getAttribute('title')).toBe(
      'Run all enabled nudgers on your selection (Ctrl+Shift+Enter)',
    );
  });

  it('uses the singular for a one-word selection', () => {
    const { scope } = render(1);
    expect(scope?.textContent).toContain('(1 word)');
  });
});
