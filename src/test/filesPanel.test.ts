import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FilesPanel } from '../components/FilesPanel';
import { ToastProvider } from '../components/Toast';
import type { ReferenceFile, Template } from '../types';
import { testNudger } from './helpers';

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

function render(files: ReferenceFile[]): string {
  return renderToStaticMarkup(
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
}

describe('reference files panel', () => {
  it('renders as a section inside the document, not as its own page', () => {
    const html = render([file('f1', 'notes.md'), file('f2', 'sources.txt')]);

    expect(html).not.toContain('<main');
    expect(html).toContain('panel-section files-panel');
    expect(html).toContain('Reference files');
    expect(html).toContain('Coach');
    expect(html).toContain('notes.md');
    expect(html).toContain('sources.txt');
  });

  it('offers the empty state when the document has no files', () => {
    expect(render([])).toContain('No reference files yet');
  });
});
