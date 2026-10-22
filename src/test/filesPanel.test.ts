import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FilesPanel } from '../components/FilesPanel';
import { ToastProvider } from '../components/Toast';
import type { Document, Nudger, ReferenceFile, Template } from '../types';

const doc: Document = {
  id: 'doc-1',
  title: 'Draft one',
  currentText: 'Some draft text.',
  createdAt: 0,
  updatedAt: 0,
};

function file(id: string, name: string): ReferenceFile {
  return {
    id,
    documentId: doc.id,
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
        doc,
        files,
        nudgers: [] as Nudger[],
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
    expect(html).toContain('notes.md');
    expect(html).toContain('sources.txt');
  });

  it('offers the empty state when the document has no files', () => {
    expect(render([])).toContain('No reference files yet');
  });
});
