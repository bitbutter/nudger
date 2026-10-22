// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { FilesPanel } from '../components/FilesPanel';
import { ToastProvider } from '../components/Toast';
import type { ReferenceFile, Template } from '../types';
import { testNudger } from './helpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nudger = testNudger({ id: 'nudger-1', name: 'Coach' });

function file(id: string, name: string): ReferenceFile {
  return {
    id,
    documentId: nudger.documentId,
    nudgerId: nudger.id,
    name,
    kind: name.endsWith('.md') ? 'md' : 'txt',
    content: `${name} contents`,
    createdAt: 0,
    updatedAt: 0,
    wordCount: 2,
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = '';
});

function render(files: ReferenceFile[]): string {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      createElement(
        ToastProvider,
        null,
        createElement(FilesPanel, {
          nudger,
          files,
          templates: [] as Template[],
          onClose: () => {},
        }),
      ),
    );
  });
  return document.body.innerHTML;
}

describe('reference files overlay', () => {
  it("opens as a dialog listing that nudger's files", () => {
    const html = render([file('f1', 'notes.md'), file('f2', 'sources.txt')]);

    expect(html).toContain('role="dialog"');
    expect(html).toContain('Reference files · Coach');
    expect(html).toContain('notes.md');
    expect(html).toContain('sources.txt');
    expect(html).toContain('files-toolbar');
  });

  it('offers the empty state when the nudger has no files', () => {
    expect(render([])).toContain('No reference files yet');
  });
});
