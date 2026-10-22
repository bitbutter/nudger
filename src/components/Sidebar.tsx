import { useEffect, useMemo, useRef, useState } from 'react';
import type { Document } from '../types';
import { formatBytes, formatRelative } from '../lib/util';

type StorageInfo = { usage: number; quota: number; percent: number } | null;

type SidebarProps = {
  documents: Document[];
  versionCounts: Record<string, number>;
  activeDocId: string | null;
  fileCount: number;
  open: boolean;
  onClose: () => void;
  onNavigate: () => void;
  onNewDocument: () => void;
  onExport: () => void;
  onImport: () => void;
  storage: StorageInfo;
  activeSection: 'doc' | 'files' | 'templates' | 'settings' | 'home';
};

export function Sidebar({
  documents,
  versionCounts,
  activeDocId,
  fileCount,
  open,
  onClose,
  onNavigate,
  onNewDocument,
  onExport,
  onImport,
  storage,
  activeSection,
}: SidebarProps) {
  const [query, setQuery] = useState('');
  const asideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (asideRef.current) asideRef.current.inert = !open;
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter(
      (doc) => doc.title.toLowerCase().includes(q) || doc.currentText.toLowerCase().includes(q),
    );
  }, [documents, query]);

  const storageWarn = storage ? storage.percent >= 80 : false;

  return (
    <>
      <div className={`sidebar-scrim ${open ? 'visible' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside
        ref={asideRef}
        className={`sidebar ${open ? 'open' : 'collapsed'}`}
        aria-label="Documents and settings"
        aria-hidden={!open}
      >
        <div className="sidebar-head">
          <a className="brand" href="#/" onClick={onNavigate} aria-label="nudger home">
            <span className="brand-mark" aria-hidden="true">
              n
            </span>
            <span>
              <span className="brand-name">nudger</span>
              <span className="brand-sub">virtual repliers for your draft</span>
            </span>
          </a>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Hide sidebar">
            ×
          </button>
        </div>

        <div className="sidebar-actions">
          <button type="button" className="btn btn-primary btn-block" onClick={() => { onNewDocument(); if (window.innerWidth <= 900) onClose(); }}>
            + New document
          </button>
          <label className="search">
            <span className="sr-only">Search documents</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search documents"
            />
          </label>
        </div>

        <div className="sidebar-scroll">
          <section className="sidebar-section">
            <h2 className="sidebar-label">
              Documents <span className="count">{documents.length}</span>
            </h2>
            {documents.length === 0 ? (
              <p className="sidebar-empty">No documents yet. Start one above.</p>
            ) : filtered.length === 0 ? (
              <p className="sidebar-empty">No documents match “{query}”.</p>
            ) : (
              <ul className="doc-list">
                {filtered.map((doc) => {
                  const count = versionCounts[doc.id] ?? 0;
                  return (
                    <li key={doc.id}>
                      <a
                        className={`doc-item ${doc.id === activeDocId ? 'active' : ''}`}
                        href={`#/doc/${encodeURIComponent(doc.id)}`}
                        onClick={onNavigate}
                        aria-current={doc.id === activeDocId ? 'page' : undefined}
                      >
                        <span className="doc-title">{doc.title}</span>
                        <span className="doc-meta">
                          <span>{formatRelative(doc.updatedAt)}</span>
                          <span className="doc-versions" title={`${count} saved versions`}>
                            {count} version{count === 1 ? '' : 's'}
                          </span>
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="sidebar-section">
            <h2 className="sidebar-label">Library</h2>
            <nav className="nav-list">
              <a
                className={`nav-item ${activeSection === 'files' ? 'active' : ''}`}
                href="#/files"
                onClick={onNavigate}
              >
                <span>Reference files</span>
                <span className="count">{fileCount}</span>
              </a>
              <a
                className={`nav-item ${activeSection === 'templates' ? 'active' : ''}`}
                href="#/templates"
                onClick={onNavigate}
              >
                <span>Prompt templates</span>
              </a>
              <a
                className={`nav-item ${activeSection === 'settings' ? 'active' : ''}`}
                href="#/settings"
                onClick={onNavigate}
              >
                <span>Settings</span>
              </a>
            </nav>
          </section>

          <section className="sidebar-section">
            <h2 className="sidebar-label">Data</h2>
            <div className="sidebar-data-actions">
              <button type="button" className="btn btn-sm" onClick={onExport}>
                Export JSON
              </button>
              <button type="button" className="btn btn-sm" onClick={onImport}>
                Import JSON
              </button>
            </div>
            {storage ? (
              <div className={`storage-meter ${storageWarn ? 'warn' : ''}`}>
                <div className="storage-meter-head">
                  <span>Browser storage</span>
                  <span>{formatBytes(storage.usage)}</span>
                </div>
                <div
                  className="storage-bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(storage.percent)}
                  aria-label="Browser storage used"
                >
                  <span style={{ width: `${Math.min(100, storage.percent)}%` }} />
                </div>
                <div className="storage-meter-foot">
                  {storageWarn
                    ? 'Nearly full. Export and delete old data.'
                    : `${formatBytes(storage.quota)} available`}
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <div className="sidebar-foot">
          <p className="privacy-note">
            <strong>Local-first.</strong> Drafts, files and keys stay in this browser. Only the
            resolved prompt is sent, and only to your provider. Auto-run sends it without opening the
            preview; every saved reply keeps the exact prompt.
          </p>
        </div>
      </aside>
    </>
  );
}
