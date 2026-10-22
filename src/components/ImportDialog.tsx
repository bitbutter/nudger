import { useRef, useState } from 'react';
import type { ExportedBundle, Settings } from '../types';
import { validateBundle } from '../lib/exportImport';
import { store, type ImportMode, type ImportSummary } from '../lib/storage';
import { getProviderPreset, providerLabel } from '../lib/providers';
import { Modal } from './Modal';
import { useToast } from './Toast';

type ImportDialogProps = {
  currentSettings: Settings;
  onClose: () => void;
  onBeforeImport: () => Promise<void> | void;
  onImported: (summary: ImportSummary) => void;
};

function hostOf(url: string): string {
  try {
    return url ? new URL(url).host : '(none)';
  } catch {
    return url || '(none)';
  }
}

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

export function ImportDialog({
  currentSettings,
  onClose,
  onBeforeImport,
  onImported,
}: ImportDialogProps) {
  const { notify } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [bundle, setBundle] = useState<ExportedBundle | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [busy, setBusy] = useState(false);
  const [restoreNetwork, setRestoreNetwork] = useState(false);

  const readFile = async (file: File) => {
    setErrors([]);
    setWarnings([]);
    setBundle(null);
    setFileName(file.name);
    if (file.size > MAX_IMPORT_BYTES) {
      setErrors(['This file is larger than 50 MB.']);
      return;
    }
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setErrors(['The file is not valid JSON.']);
        return;
      }
      const result = validateBundle(parsed);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setBundle(result.bundle);
      setWarnings(result.warnings);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    }
  };

  const runImport = async () => {
    if (!bundle) return;
    setBusy(true);
    try {
      await onBeforeImport();
      const summary = await store.importBundle(bundle, mode, {
        restoreNetworkSettings: !networkChanged || restoreNetwork,
      });
      notify(
        `Imported ${summary.documents} document(s), ${summary.files} file(s), ${summary.nudgers} nudger(s).`,
        'success',
      );
      onImported(summary);
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const networkChanged = bundle
    ? bundle.settings.baseUrl.trim() !== currentSettings.baseUrl.trim() ||
      JSON.stringify(bundle.settings.customHeaders ?? {}) !==
        JSON.stringify(currentSettings.customHeaders ?? {})
    : false;

  const counts = bundle
    ? [
        ['documents', bundle.documents.length],
        ['versions', bundle.versions.length],
        ['reference files', bundle.files.length],
        ['nudgers', bundle.nudgers.length],
        ['replies', bundle.replies.length],
        ['templates', bundle.templates.length],
      ]
    : [];

  return (
    <Modal
      title="Import nudger data"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={runImport} disabled={!bundle || busy}>
            {busy ? 'Importing…' : mode === 'replace' ? 'Replace all data' : 'Merge into this browser'}
          </button>
        </>
      }
    >
      <div className="field">
        <span>Export file (.json)</span>
        <div className="import-file-row">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            Choose file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void readFile(file);
            }}
          />
          <span className="field-note">{fileName || 'No file chosen'}</span>
        </div>
      </div>

      {errors.length > 0 ? (
        <div className="issue issue-block">
          <strong>Import stopped.</strong>
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {bundle ? (
        <>
          <div className="import-summary">
            {counts.map(([label, count]) => (
              <div key={String(label)}>
                <span>{label}</span>
                <strong>{Number(count).toLocaleString()}</strong>
              </div>
            ))}
          </div>

          <fieldset className="import-mode">
            <legend>How should this import land?</legend>
            <label className={`radio-card ${mode === 'merge' ? 'active' : ''}`}>
              <input
                type="radio"
                name="import-mode"
                value="merge"
                checked={mode === 'merge'}
                onChange={() => setMode('merge')}
              />
              <span>
                <strong>Merge</strong>
                <span>
                  Add items whose ids are not already here. Keep your current documents, files and
                  settings untouched. Existing ids and duplicate file names are skipped.
                </span>
              </span>
            </label>
            <label className={`radio-card ${mode === 'replace' ? 'active' : ''}`}>
              <input
                type="radio"
                name="import-mode"
                value="replace"
                checked={mode === 'replace'}
                onChange={() => setMode('replace')}
              />
              <span>
                <strong>Replace</strong>
                <span>
                  Delete all current documents, versions, files, nudgers, replies, templates and
                  settings, then load the export. API keys are never imported and are not deleted by
                  the settings table replacement; use Clear key if needed.
                </span>
              </span>
            </label>
          </fieldset>

          {bundle && mode === 'replace' && networkChanged ? (
            <div className="issue issue-warn">
              <p>
                This export points the provider at <strong>{hostOf(bundle.settings.baseUrl)}</strong>
                {' '}and may include custom headers. To protect your API key, importing will keep the
                standard endpoint for {providerLabel(bundle.settings.providerId)} (
                {getProviderPreset(bundle.settings.providerId).baseUrl || 'none set'}) and drop
                custom headers unless you tick the box below.
              </p>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={restoreNetwork}
                  onChange={(event) => setRestoreNetwork(event.target.checked)}
                />
                <span>Restore the exported base URL and custom headers anyway</span>
              </label>
            </div>
          ) : null}

          <p className="field-note">
            Keys are excluded from exports. Reference files are included, so keep exports private.
            {warnings.length > 0 ? ' Some items were dropped during validation; see below.' : ''}
          </p>

          {warnings.length > 0 ? (
            <details className="import-warnings">
              <summary>{warnings.length} validation warning(s)</summary>
              <ul>
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}
