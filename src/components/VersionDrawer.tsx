import { useEffect, useState } from 'react';
import type { Document, Version } from '../types';
import { Modal } from './Modal';
import { formatDateTime, wordCount } from '../lib/util';

type VersionDrawerProps = {
  doc: Document;
  versions: Version[];
  onClose: () => void;
  onRestore: (version: Version) => Promise<void>;
  onDelete: (version: Version) => Promise<void>;
};

export function VersionDrawer({ doc, versions, onClose, onRestore, onDelete }: VersionDrawerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(versions[0]?.id ?? null);
  const [pending, setPending] = useState<{ action: 'restore' | 'delete'; id: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (versions.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !versions.some((version) => version.id === selectedId)) {
      setSelectedId(versions[0].id);
    }
  }, [versions, selectedId]);

  const selected = versions.find((version) => version.id === selectedId) ?? null;
  const pendingFor = pending && selected && pending.id === selected.id ? pending.action : null;

  const restore = async (version: Version) => {
    setBusy(true);
    try {
      await onRestore(version);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (version: Version) => {
    setBusy(true);
    try {
      await onDelete(version);
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Version history"
      subtitle={`${doc.title} · ${versions.length} saved version${versions.length === 1 ? '' : 's'}`}
      onClose={onClose}
      drawer
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      {versions.length === 0 ? (
        <div className="empty-inline">
          <p>No versions yet. Saving a version keeps a permanent snapshot with its timestamp and word count.</p>
          <p className="field-note">Use “Save version” in the header or Ctrl+S.</p>
        </div>
      ) : (
        <div className="version-layout">
          <ul className="version-list" aria-label="Saved versions">
            {versions.map((version, index) => (
              <li key={version.id}>
                <button
                  type="button"
                  className={`version-item ${version.id === selectedId ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedId(version.id);
                    setPending(null);
                  }}
                >
                  <span className="version-name">
                    {version.label || `Snapshot ${versions.length - index}`}
                  </span>
                  <span className="version-meta">
                    {formatDateTime(version.createdAt)} · {version.wordCount.toLocaleString()} words
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {selected ? (
            <div className="version-preview">
              <div className="version-preview-head">
                <div>
                  <h3>{selected.label || 'Snapshot'}</h3>
                  <p className="field-note">
                    {formatDateTime(selected.createdAt)} · {wordCount(selected.text).toLocaleString()} words
                  </p>
                </div>
                <div className="version-preview-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => setPending({ action: 'restore', id: selected.id })}
                    disabled={busy}
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => setPending({ action: 'delete', id: selected.id })}
                    disabled={busy}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {pendingFor === 'restore' ? (
                <div className="confirm-inline">
                  <p>
                    Restore this text as the current draft? Your current text is saved as a
                    “Before restore” version first, and this creates a new version. Nothing is
                    overwritten.
                  </p>
                  <div className="confirm-inline-actions">
                    <button type="button" className="btn btn-sm" onClick={() => setPending(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => void restore(selected)}
                      disabled={busy}
                    >
                      {busy ? 'Restoring…' : 'Confirm restore'}
                    </button>
                  </div>
                </div>
              ) : null}

              {pendingFor === 'delete' ? (
                <div className="confirm-inline danger">
                  <p>Delete this saved version? This cannot be undone.</p>
                  <div className="confirm-inline-actions">
                    <button type="button" className="btn btn-sm" onClick={() => setPending(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => void remove(selected)}
                      disabled={busy}
                    >
                      {busy ? 'Deleting…' : 'Confirm delete'}
                    </button>
                  </div>
                </div>
              ) : null}

              <pre className="version-text">{selected.text || '(empty snapshot)'}</pre>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

type SaveVersionModalProps = {
  onClose: () => void;
  onSave: (label: string | undefined) => Promise<void>;
};

export function SaveVersionModal({ onClose, onSave }: SaveVersionModalProps) {
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      title="Save version"
      subtitle="Creates a permanent snapshot with the current text, timestamp and word count."
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(label.trim() || undefined);
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Saving…' : 'Save version'}
          </button>
        </>
      }
    >
      <label className="field">
        <span>Label (optional)</span>
        <input
          className="input"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="e.g. Before the rewrite"
          autoFocus
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void (async () => {
                setBusy(true);
                try {
                  await onSave(label.trim() || undefined);
                  onClose();
                } finally {
                  setBusy(false);
                }
              })();
            }
          }}
        />
      </label>
      <p className="field-note">Leave blank for an automatic “Snapshot N” label.</p>
    </Modal>
  );
}
