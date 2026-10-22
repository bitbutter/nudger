import { useEffect, useRef, useState } from 'react';
import type { ProviderId, Settings } from '../types';
import { getProviderPreset, PROVIDER_PRESETS, resolveProviderConfig, testProviderConnection } from '../lib/providers';
import { NudgeError } from '../lib/errors';
import { maskKey } from '../lib/keyStore';
import { formatBytes } from '../lib/util';
import { Modal } from './Modal';
import { useToast } from './Toast';

type StorageInfo = { usage: number; quota: number; percent: number } | null;

type SettingsPageProps = {
  settings: Settings;
  apiKey: string;
  storage: StorageInfo;
  onToggleSidebar: () => void;
  onSave: (patch: Partial<Settings>) => Promise<void>;
  onSaveKey: (key: string, remember: boolean) => Promise<void>;
  onClearKey: () => void;
  onClearAll: (removeKey: boolean) => Promise<void>;
  onExport: () => void;
  onImport: () => void;
};

function ClearDataDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (removeKey: boolean) => Promise<void>;
}) {
  const [word, setWord] = useState('');
  const [removeKey, setRemoveKey] = useState(true);
  const [busy, setBusy] = useState(false);
  const ready = word.trim().toLowerCase() === 'delete';
  return (
    <Modal
      title="Clear all local data"
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(removeKey);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Deleting…' : 'Delete everything'}
          </button>
        </>
      }
    >
      <p>
        This deletes every document, version, reference file, nudger, reply, custom template and
        setting stored by nudger in this browser. Export first if you want a copy. This cannot be
        undone.
      </p>
      <label className="checkbox-row">
        <input type="checkbox" checked={removeKey} onChange={(event) => setRemoveKey(event.target.checked)} />
        <span>Also remove the stored API key</span>
      </label>
      <label className="field">
        <span>Type “delete” to confirm</span>
        <input className="input" value={word} onChange={(event) => setWord(event.target.value)} autoFocus />
      </label>
    </Modal>
  );
}

export function SettingsPage({
  settings,
  apiKey,
  storage,
  onToggleSidebar,
  onSave,
  onSaveKey,
  onClearKey,
  onClearAll,
  onExport,
  onImport,
}: SettingsPageProps) {
  const { notify } = useToast();
  const [form, setForm] = useState<Settings>(settings);
  const [headersText, setHeadersText] = useState(
    settings.customHeaders ? JSON.stringify(settings.customHeaders, null, 2) : '',
  );
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (dirtyRef.current) return;
    setForm(settings);
    setHeadersText(settings.customHeaders ? JSON.stringify(settings.customHeaders, null, 2) : '');
  }, [settings]);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    dirtyRef.current = true;
    setForm((current) => ({ ...current, [key]: value }));
  };

  const chooseProvider = (id: ProviderId) => {
    const preset = getProviderPreset(id);
    dirtyRef.current = true;
    setForm((current) => ({
      ...current,
      providerId: id,
      baseUrl: preset.baseUrl,
      model: preset.defaultModel,
      customHeaders: current.customHeaders,
    }));
    setTestResult(null);
  };

  const parseHeaders = (): Record<string, string> | undefined => {
    if (!headersText.trim()) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(headersText);
    } catch {
      throw new NudgeError('config', 'Custom headers must be valid JSON.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new NudgeError('config', 'Custom headers must be a JSON object of string values.');
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'string') {
        throw new NudgeError('config', `Header "${key}" must have a string value.`);
      }
      if (key.trim()) out[key.trim()] = value;
    }
    return Object.keys(out).length ? out : undefined;
  };

  const save = async () => {
    setSaving(true);
    try {
      const headers = parseHeaders();
      dirtyRef.current = false;
      await onSave({ ...form, customHeaders: headers, apiKey: undefined });
      if (keyInput.trim()) {
        await onSaveKey(keyInput.trim(), form.rememberKey);
        setKeyInput('');
      }
      notify('Settings saved.', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const headers = parseHeaders();
      const resolved = resolveProviderConfig(form);
      const key = keyInput.trim() || apiKey;
      if (!key) throw new NudgeError('config', 'Enter an API key to test the connection.');
      const result = await testProviderConnection({
        provider: { ...resolved, maxTokens: Math.min(32, Math.max(1, resolved.maxTokens)), temperature: 0 },
        apiKey: key,
        system: 'You are a connection test.',
        user: 'Reply with the single word: ok',
        customHeaders: headers,
        timeoutMs: Math.min(form.requestTimeoutMs, 30_000),
      });
      setTestResult({
        ok: true,
        text: `Connected in ${result.latencyMs} ms with ${resolved.model}. Reply: “${result.text.slice(0, 80)}”`,
      });
    } catch (error) {
      setTestResult({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  };

  const preset = getProviderPreset(form.providerId);

  return (
    <main className="page settings-page">
      <header className="page-head">
        <div className="page-head-lead">
          <button type="button" className="icon-btn" onClick={onToggleSidebar} aria-label="Toggle sidebar">
            ☰
          </button>
          <div>
            <h1>Settings</h1>
            <p className="page-sub">
              Bring your own key. The key and all app data live in this browser, never on a server.
            </p>
          </div>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn" onClick={test} disabled={testing}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </header>

      {testResult ? (
        <div className={`banner ${testResult.ok ? 'banner-ok' : 'banner-error'}`} role="status">
          <span>{testResult.text}</span>
          <button type="button" className="icon-btn" onClick={() => setTestResult(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ) : null}

      <div className="settings-layout">
        <div className="settings-main">
          <section className="panel-section">
            <h2>Provider and model</h2>
            <div className="field-row">
              <label className="field grow">
                <span>Provider</span>
                <select
                  className="select"
                  value={form.providerId}
                  onChange={(event) => chooseProvider(event.target.value as ProviderId)}
                >
                  {PROVIDER_PRESETS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field grow">
                <span>Model</span>
                <input
                  className="input"
                  value={form.model}
                  onChange={(event) => set('model', event.target.value)}
                  placeholder={preset.defaultModel || 'model id'}
                />
              </label>
            </div>
            <p className="field-note">
              {preset.notes}
              {preset.docsUrl ? (
                <>
                  {' '}
                  <a href={preset.docsUrl} target="_blank" rel="noreferrer noopener">
                    Provider docs
                  </a>
                </>
              ) : null}
            </p>

            <label className="field">
              <span>Base URL</span>
              <input
                className="input"
                value={form.baseUrl}
                onChange={(event) => set('baseUrl', event.target.value)}
                placeholder={preset.baseUrl || 'https://your-endpoint.example/v1'}
                spellCheck={false}
              />
            </label>
            <p className="field-note">
              The adapter adds /chat/completions (OpenAI-compatible) or /v1/messages (Anthropic). A
              full endpoint URL is also accepted. The endpoint must allow browser CORS requests.
            </p>

            <label className="field">
              <span>Custom headers (JSON, optional)</span>
              <textarea
                className="textarea code"
                rows={3}
                value={headersText}
                onChange={(event) => {
                  dirtyRef.current = true;
                  setHeadersText(event.target.value);
                }}
                placeholder={'{"X-Client":"nudger"}'}
                spellCheck={false}
              />
            </label>
            <p className="field-note">
              Sent with every request, to whichever provider is selected. Do not put an API key here;
              use the key field below. Header values are stored with your settings and appear in
              exports.
            </p>
          </section>

          <section className="panel-section">
            <h2>API key</h2>
            <p className="field-note">
              Current key: <strong>{maskKey(apiKey)}</strong>
            </p>
            <div className="key-row">
              <label className="field grow">
                <span>{apiKey ? 'Replace key' : 'Paste key'}</span>
                <input
                  className="input"
                  type={showKey ? 'text' : 'password'}
                  value={keyInput}
                  onChange={(event) => setKeyInput(event.target.value)}
                  placeholder={apiKey ? 'Paste a new key to replace the saved one' : 'sk-…'}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <button type="button" className="btn" onClick={() => setShowKey((value) => !value)}>
                {showKey ? 'Hide' : 'Show'}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!keyInput.trim()}
                onClick={async () => {
                  await onSaveKey(keyInput.trim(), form.rememberKey);
                  setKeyInput('');
                  notify('Key saved for this device.', 'success');
                }}
              >
                Save key
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  onClearKey();
                  setKeyInput('');
                  notify('API key removed.', 'success');
                }}
                disabled={!apiKey}
              >
                Clear key
              </button>
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.rememberKey}
                onChange={(event) => set('rememberKey', event.target.checked)}
              />
              <span>Remember key on this device</span>
            </label>
            {form.rememberKey ? (
              <p className="issue issue-warn">
                The key is kept in localStorage. Any script running on this page could read it.
                nudger ships no third-party scripts, but a modified copy of the app could. Leave this
                off if that risk matters.
              </p>
            ) : (
              <p className="field-note">
                The key is kept in sessionStorage and is gone when this tab closes. Nothing is kept
                in localStorage.
              </p>
            )}
            <p className="field-note">
              Keys are never written to IndexedDB, never included in exports, never logged, and never
              sent anywhere except the provider you choose.
            </p>
          </section>

          <section className="panel-section">
            <h2>Generation defaults</h2>
            <div className="field-row">
              <label className="field">
                <span>Temperature</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={form.temperature}
                  onChange={(event) =>
                    set('temperature', Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0)
                  }
                />
              </label>
              <label className="field">
                <span>Max tokens</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={64000}
                  value={form.maxTokens}
                  onChange={(event) =>
                    set('maxTokens', Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 1)
                  }
                />
              </label>
              <label className="field grow">
                <span>Default max context characters</span>
                <input
                  className="input"
                  type="number"
                  min={1000}
                  step={1000}
                  value={form.maxContextChars}
                  onChange={(event) =>
                    set(
                      'maxContextChars',
                      Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 100000,
                    )
                  }
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Auto-run delay (seconds)</span>
                <input
                  className="input"
                  type="number"
                  min={0.25}
                  max={60}
                  step={0.25}
                  value={form.autoRunDelayMs / 1000}
                  onChange={(event) => {
                    const value = event.target.valueAsNumber;
                    if (Number.isFinite(value)) set('autoRunDelayMs', Math.round(value * 1000));
                  }}
                />
              </label>
              <label className="field">
                <span>Max concurrent runs</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={8}
                  value={form.maxConcurrentRuns}
                  onChange={(event) => {
                    const value = event.target.valueAsNumber;
                    if (Number.isFinite(value)) set('maxConcurrentRuns', Math.round(value));
                  }}
                />
              </label>
              <label className="field">
                <span>Request timeout (seconds)</span>
                <input
                  className="input"
                  type="number"
                  min={5}
                  max={300}
                  value={form.requestTimeoutMs / 1000}
                  onChange={(event) => {
                    const value = event.target.valueAsNumber;
                    if (Number.isFinite(value)) set('requestTimeoutMs', Math.round(value * 1000));
                  }}
                />
              </label>
            </div>
            <p className="field-note">
              New nudgers copy the context limit. Auto-run only starts when you stop typing, never on
              an empty document. Concurrent calls beyond the limit wait in a queue.
            </p>
          </section>

          <section className="panel-section">
            <h2>Appearance</h2>
            <div className="field-row">
              <label className="field">
                <span>Theme</span>
                <select
                  className="select"
                  value={form.theme}
                  onChange={(event) => set('theme', event.target.value === 'light' ? 'light' : 'dark')}
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </label>
              <label className="field grow">
                <span>Layout</span>
                <select
                  className="select"
                  value={form.layout}
                  onChange={(event) => set('layout', event.target.value === 'side' ? 'side' : 'stacked')}
                >
                  <option value="stacked">Nudgers below the editor</option>
                  <option value="side">Nudgers beside the editor (wide screens)</option>
                </select>
              </label>
            </div>
          </section>

          <section className="panel-section">
            <h2>Data</h2>
            <div className="data-actions">
              <button type="button" className="btn" onClick={onExport}>
                Export all data (JSON)
              </button>
              <button type="button" className="btn" onClick={onImport}>
                Import from JSON
              </button>
            </div>
            <p className="field-note">
              Exports contain documents, versions, reference files, nudgers, replies, custom templates
              and settings. API keys are excluded.
            </p>
            {storage ? (
              <p className="field-note">
                Storage used: {formatBytes(storage.usage)} of about {formatBytes(storage.quota)} (
                {storage.percent.toFixed(1)}%).
                {storage.percent >= 80 ? ' Browser storage is nearly full; export and remove old data.' : ''}
              </p>
            ) : null}
            <div className="danger-zone">
              <div>
                <h3>Clear all data</h3>
                <p>Delete every document, file, nudger and setting from this browser.</p>
              </div>
              <button type="button" className="btn btn-danger" onClick={() => setClearOpen(true)}>
                Clear all data
              </button>
            </div>
          </section>

          <section className="panel-section">
            <h2>Privacy</h2>
            <p>
              nudger is a static page with no backend, no analytics and no third-party scripts. Your
              drafts, versions, reference files, nudger definitions and settings are stored in
              IndexedDB in this browser. The API key is in sessionStorage, or localStorage if you
              choose to remember it.
            </p>
            <p>
              Text leaves this browser only when you run a nudger: the exact resolved prompt shown in
              the preview — including any attached reference files — is sent to your chosen provider.
              Provider-side retention is governed by that provider’s terms. Nothing is inserted into
              your document automatically.
            </p>
            <p>
              No browser storage is secure against a compromised page or compromised device. If you
              do not trust this copy of the app, do not paste a key. Exporting includes reference files
              and custom headers; keep exports private.
            </p>
          </section>
        </div>

        <aside className="settings-side">
          <section className="panel-section">
            <h2>Keyboard shortcuts</h2>
            <dl className="shortcut-list">
              <div><dt><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd></dt><dd>New document</dd></div>
              <div><dt><kbd>Ctrl</kbd>+<kbd>S</kbd></dt><dd>Save version</dd></div>
              <div><dt><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd></dt><dd>Run all nudgers</dd></div>
              <div><dt><kbd>Ctrl</kbd>+<kbd>Enter</kbd></dt><dd>Run focused nudger</dd></div>
              <div><dt><kbd>Ctrl</kbd>+<kbd>B</kbd></dt><dd>Toggle sidebar</dd></div>
              <div><dt><kbd>Ctrl</kbd>+<kbd>,</kbd></dt><dd>Open settings</dd></div>
            </dl>
          </section>
          <section className="panel-section">
            <h2>Where things go</h2>
            <p className="field-note">
              Documents and replies are separate per document. Reference files are global to the
              library. Nudgers are shared across documents; each document has its own reply history
              and budget count for each nudger.
            </p>
          </section>
        </aside>
      </div>

      {clearOpen ? (
        <ClearDataDialog
          onClose={() => setClearOpen(false)}
          onConfirm={async (removeKey) => {
            await onClearAll(removeKey);
            setClearOpen(false);
          }}
        />
      ) : null}
    </main>
  );
}
