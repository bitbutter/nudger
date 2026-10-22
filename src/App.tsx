import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type {
  Caret,
  Document,
  Nudger,
  ReferenceFile,
  Reply,
  ReplyStatus,
  Settings,
  Template,
  Version,
} from './types';
import {
  describeStorageError,
  estimateStorage,
  store,
  type ImportSummary,
} from './lib/storage';
import { navigate, useHashRoute } from './lib/hashRoute';
import { useToast } from './components/Toast';
import { useDraft } from './hooks/useDraft';
import { executeRun, prepareRun } from './lib/run';
import { RunManager, type RunState } from './lib/runManager';
import { effectiveCustomHeaders, getProviderPreset } from './lib/providers';
import { clearApiKey, loadApiKey, saveApiKey } from './lib/keyStore';
import { blankTemplate, nudgerFromTemplate } from './lib/starters';
import { downloadText, newId } from './lib/util';
import { exportFileName } from './lib/exportImport';
import { Sidebar } from './components/Sidebar';
import { DocumentView } from './components/DocumentView';
import { Welcome } from './components/Welcome';
import { FilesPage } from './components/FilesPage';
import { TemplatesPage } from './components/TemplatesPage';
import { SettingsPage } from './components/SettingsPage';
import { VersionDrawer, SaveVersionModal } from './components/VersionDrawer';
import { ImportDialog } from './components/ImportDialog';
import { PromptPreview } from './components/PromptPreview';
import { NudgerEditor } from './components/NudgerEditor';
import { AddNudgerModal } from './components/AddNudgerModal';
import { ConfirmDialog } from './components/Modal';

type StorageInfo = { usage: number; quota: number; percent: number } | null;

type ConfirmState = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  action: () => Promise<void> | void;
};

type EditorState = { mode: 'create' | 'edit'; initial: Nudger };

function initialSidebarOpen(): boolean {
  try {
    const saved = localStorage.getItem('nudger.sidebar');
    if (saved === '1') return true;
    if (saved === '0') return false;
  } catch {
    // ignore
  }
  return typeof window !== 'undefined' ? window.innerWidth > 900 : true;
}

export default function App() {
  const { notify } = useToast();
  const route = useHashRoute();

  const documents = useLiveQuery(() => store.listDocuments(), []);
  const nudgers = useLiveQuery(() => store.listNudgers(), []);
  const files = useLiveQuery(() => store.listFiles(), []);
  const templates = useLiveQuery(() => store.listTemplates(), []);
  const settings = useLiveQuery(() => store.getSettings(), []);
  const versionCounts = useLiveQuery(() => store.listVersionCounts(), []);
  const activeId = route.name === 'doc' ? route.id : null;
  const activeDoc = documents?.find((doc) => doc.id === activeId) ?? null;

  const [caret, setCaret] = useState<Caret>({ start: 0, end: 0 });
  const draft = useDraft(activeDoc, notify);

  const replies = useLiveQuery(
    () => (activeId ? store.listReplies(activeId) : Promise.resolve([] as Reply[])),
    [activeId],
  );
  const versions = useLiveQuery(
    () => (activeId ? store.listVersions(activeId) : Promise.resolve([] as Version[])),
    [activeId],
  );

  const [apiKey, setApiKey] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(initialSidebarOpen);
  const [runStates, setRunStates] = useState<Record<string, RunState>>({});
  const [focusedNudgerId, setFocusedNudgerId] = useState<string | null>(null);
  const [previewNudgerId, setPreviewNudgerId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [saveVersionOpen, setSaveVersionOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [storage, setStorage] = useState<StorageInfo>(null);

  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const activeDocRef = useRef<Document | null>(activeDoc);
  activeDocRef.current = activeDoc;
  const textRef = useRef(draft.text);
  textRef.current = draft.text;
  const caretRef = useRef(caret);
  caretRef.current = caret;
  const apiKeyRef = useRef(apiKey);
  apiKeyRef.current = apiKey;
  const nudgersRef = useRef<Nudger[]>([]);
  nudgersRef.current = nudgers ?? [];
  const filesRef = useRef<ReferenceFile[]>([]);
  filesRef.current = files ?? [];
  const repliesRef = useRef<Reply[]>([]);
  repliesRef.current = replies ?? [];
  const settingsRef = useRef<Settings | null>(null);
  settingsRef.current = settings ?? null;
  const focusedNudgerIdRef = useRef<string | null>(null);
  focusedNudgerIdRef.current = focusedNudgerId;
  const keyLoadedRef = useRef(false);
  const autoWarnedRef = useRef<Set<string>>(new Set());

  const managerRef = useRef<RunManager | null>(null);
  if (!managerRef.current) {
    managerRef.current = new RunManager({
      execute: async (job, handlers) =>
        (await executeRun(job, handlers, (input) => store.addReply(input))).reply,
      onStates: setRunStates,
      onError: (state) => {
        const name = nudgersRef.current.find((nudger) => nudger.id === state.nudgerId)?.name ?? 'Nudger';
        notifyRef.current(`${name}: ${state.error?.message ?? 'The run failed.'}`, 'error');
      },
    });
  }
  const manager = managerRef.current;

  const refreshStorage = useCallback(async () => {
    setStorage(await estimateStorage());
  }, []);

  const closeOnNarrow = useCallback(() => {
    if (window.innerWidth <= 900) setSidebarOpen(false);
  }, []);

  // ------------------------------------------------------------------ effects

  useEffect(() => {
    if (!settings) return;
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.colorScheme = settings.theme;
  }, [settings?.theme]);

  useEffect(() => {
    if (!settings || keyLoadedRef.current) return;
    keyLoadedRef.current = true;
    setApiKey(loadApiKey(settings.rememberKey).key);
  }, [settings]);

  useEffect(() => {
    manager.setMaxConcurrent(settings?.maxConcurrentRuns ?? 2);
  }, [manager, settings?.maxConcurrentRuns]);

  useEffect(() => {
    void refreshStorage();
    const timer = setInterval(() => void refreshStorage(), 30_000);
    return () => clearInterval(timer);
  }, [refreshStorage]);

  useEffect(() => {
    void refreshStorage();
  }, [documents?.length, files?.length, nudgers?.length, replies?.length, refreshStorage]);

  useEffect(() => {
    try {
      localStorage.setItem('nudger.sidebar', sidebarOpen ? '1' : '0');
    } catch {
      // ignore
    }
  }, [sidebarOpen]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)');
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setSidebarOpen(false);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    setFocusedNudgerId(null);
    setVersionsOpen(false);
    setPreviewNudgerId(null);
  }, [activeId]);

  useEffect(() => {
    if (documents === undefined) return;
    if (route.name === 'doc' && !documents.some((doc) => doc.id === route.id)) {
      navigate({ name: 'home' });
    }
  }, [route, documents]);

  useEffect(() => {
    if (documents && documents.length > 0 && route.name === 'home') {
      navigate({ name: 'doc', id: documents[0].id });
    }
  }, [route.name, documents]);

  useEffect(() => {
    if (!activeDoc && previewNudgerId) setPreviewNudgerId(null);
  }, [activeDoc, previewNudgerId]);

  // -------------------------------------------------------------- run helpers

  const enqueue = (prepared: ReturnType<typeof prepareRun>, key: string) => {
    const cfg = settingsRef.current;
    if (!cfg) return false;
    const result = manager.enqueue({
      prepared,
      apiKey: key,
      timeoutMs: cfg.requestTimeoutMs,
      maxRetries: 2,
      customHeaders: effectiveCustomHeaders(cfg),
    });
    return result !== 'duplicate';
  };

  async function runNudger(
    nudger: Nudger,
    options: { source: 'manual' | 'auto'; force?: boolean; trim?: boolean },
  ) {
    const manual = options.source === 'manual';
    const doc = activeDocRef.current;
    const cfg = settingsRef.current;
    if (!doc || !cfg) {
      if (manual) notify('Open a document first.', 'warn');
      return;
    }
    if (!nudger.enabled) {
      if (manual) notify(`${nudger.name} is disabled. Enable it from its menu.`, 'warn');
      return;
    }
    if (nudger.done) {
      if (manual) notify(`${nudger.name} is marked done. Reopen it from its menu.`, 'warn');
      return;
    }
    if (manager.isBusy(nudger.id)) {
      if (manual) notify(`${nudger.name} is already running.`, 'warn');
      return;
    }
    const used = repliesRef.current.filter((reply) => reply.nudgerId === nudger.id).length;
    if (used >= nudger.budget) {
      if (manual) {
        notify(
          `${nudger.name} has used its budget (${used}/${nudger.budget}). Use “More +3” on the card to add allowance.`,
          'warn',
        );
      }
      return;
    }
    const key = apiKeyRef.current;
    if (!key) {
      if (manual) notify('No API key yet. Add one in Settings, then run the nudger.', 'warn');
      return;
    }

    const prepared = prepareRun({
      nudger,
      document: { id: doc.id, title: doc.title, currentText: textRef.current },
      caret: caretRef.current,
      files: filesRef.current,
      settings: cfg,
      trimToLimit: options.trim,
    });

    if (prepared.blocking || (prepared.overLimit && !options.force)) {
      if (manual) {
        setPreviewNudgerId(nudger.id);
        if (prepared.blocking) notify('This nudger has a blocking prompt issue. See the preview.', 'warn');
      } else {
        const reason =
          prepared.configError ||
          prepared.issues.find((issue) => issue.blocking)?.message ||
          `The prompt is ${prepared.totalChars.toLocaleString()} characters, over the ${prepared.maxContextChars.toLocaleString()} limit.`;
        const warnKey = `${doc.id}:${nudger.id}:${reason.slice(0, 90)}`;
        if (!autoWarnedRef.current.has(warnKey)) {
          autoWarnedRef.current.add(warnKey);
          notify(`${nudger.name}: ${reason} Open Preview to fix it or run anyway.`, 'warn');
        }
      }
      return;
    }

    if (!enqueue(prepared, key)) {
      if (manual) notify(`${nudger.name} is already running.`, 'warn');
    }
  }

  function runAll() {
    const doc = activeDocRef.current;
    const cfg = settingsRef.current;
    const key = apiKeyRef.current;
    if (!doc || !cfg) {
      notify('Open a document first.', 'warn');
      return;
    }
    if (!key) {
      notify('No API key yet. Add one in Settings before running nudgers.', 'warn');
      return;
    }
    const eligible = nudgersRef.current.filter((nudger) => nudger.enabled && !nudger.done);
    if (eligible.length === 0) {
      notify('No enabled nudgers to run.', 'warn');
      return;
    }
    const blocked: Nudger[] = [];
    let started = 0;
    for (const nudger of eligible) {
      const used = repliesRef.current.filter((reply) => reply.nudgerId === nudger.id).length;
      if (used >= nudger.budget || manager.isBusy(nudger.id)) continue;
      const prepared = prepareRun({
        nudger,
        document: { id: doc.id, title: doc.title, currentText: textRef.current },
        caret: caretRef.current,
        files: filesRef.current,
        settings: cfg,
      });
      if (prepared.blocking || prepared.overLimit) {
        blocked.push(nudger);
        continue;
      }
      if (enqueue(prepared, key)) started += 1;
    }
    if (blocked.length > 0) {
      setPreviewNudgerId(blocked[0].id);
      notify(
        `${blocked.length} nudger(s) need attention before they can run. Showing the first preview.`,
        'warn',
      );
    } else if (started === 0) {
      notify('Nothing was eligible to run (busy, done, or out of budget).', 'info');
    }
  }

  function runFocused() {
    const focused = nudgersRef.current.find((nudger) => nudger.id === focusedNudgerIdRef.current);
    const nudger = focused ?? nudgersRef.current.find((item) => item.enabled && !item.done);
    if (!nudger) {
      notify('No nudger to run. Add one first.', 'warn');
      return;
    }
    void runNudger(nudger, { source: 'manual' });
  }

  async function newDocument() {
    try {
      const doc = await store.createDocument();
      closeOnNarrow();
      navigate({ name: 'doc', id: doc.id });
    } catch (error) {
      notify(describeStorageError(error), 'error');
    }
  }

  const newDocumentRef = useRef(newDocument);
  newDocumentRef.current = newDocument;
  const runAllRef = useRef(runAll);
  runAllRef.current = runAll;
  const runFocusedRef = useRef(runFocused);
  runFocusedRef.current = runFocused;
  const runNudgerRef = useRef(runNudger);
  runNudgerRef.current = runNudger;

  const modalOpen =
    Boolean(previewNudgerId) ||
    Boolean(editor) ||
    addOpen ||
    versionsOpen ||
    saveVersionOpen ||
    importOpen ||
    Boolean(confirm);
  const modalOpenRef = useRef(modalOpen);
  modalOpenRef.current = modalOpen;

  // ------------------------------------------------------------ auto-run timer

  useEffect(() => {
    if (draft.editSeq === 0) return;
    const cfg = settingsRef.current;
    if (!cfg || !apiKeyRef.current) return;
    if (!textRef.current.trim()) return;
    const handled = new Set<string>();
    let retry: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const tick = () => {
      if (cancelled || modalOpenRef.current) return;
      const doc = activeDocRef.current;
      if (!doc || !textRef.current.trim()) return;
      const candidates = nudgersRef.current.filter(
        (nudger) => nudger.autoRun && nudger.enabled && !nudger.done,
      );
      let waiting = false;
      for (const nudger of candidates) {
        if (handled.has(nudger.id)) continue;
        if (manager.isBusy(nudger.id)) {
          waiting = true;
          continue;
        }
        const used = repliesRef.current.filter((reply) => reply.nudgerId === nudger.id).length;
        handled.add(nudger.id);
        if (used >= nudger.budget) continue;
        void runNudgerRef.current(nudger, { source: 'auto' });
      }
      if (waiting) retry = setTimeout(tick, 1200);
    };

    const timer = setTimeout(tick, cfg.autoRunDelayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (retry) clearTimeout(retry);
    };
  }, [draft.editSeq, manager]);

  // ---------------------------------------------------------------- shortcuts

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      if (modalOpenRef.current) return;
      if (event.altKey && !event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        newDocumentRef.current();
        return;
      }
      if (event.key.toLowerCase() === 's' && !event.shiftKey) {
        if (activeDocRef.current) {
          event.preventDefault();
          setSaveVersionOpen(true);
        }
        return;
      }
      if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault();
        runAllRef.current();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        runFocusedRef.current();
        return;
      }
      if (event.key.toLowerCase() === 'b' && !event.shiftKey) {
        event.preventDefault();
        setSidebarOpen((value) => !value);
        return;
      }
      if (event.key === ',') {
        event.preventDefault();
        navigate({ name: 'settings' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ------------------------------------------------------------- data actions

  const renameActive = async (title: string) => {
    if (!activeDocRef.current) return;
    try {
      await store.renameDocument(activeDocRef.current.id, title);
    } catch (error) {
      notify(describeStorageError(error), 'error');
    }
  };

  const duplicateActive = async () => {
    if (!activeDocRef.current) return;
    try {
      await draft.flush();
      const copy = await store.duplicateDocument(activeDocRef.current.id);
      if (copy) {
        notify('Document duplicated.', 'success');
        navigate({ name: 'doc', id: copy.id });
      }
    } catch (error) {
      notify(describeStorageError(error), 'error');
    }
  };

  const deleteActive = () => {
    const doc = activeDocRef.current;
    if (!doc) return;
    setConfirm({
      title: `Delete “${doc.title}”?`,
      message:
        'This deletes the document, all of its saved versions and all reply history for this document. Other documents and reference files are not affected. This cannot be undone.',
      confirmLabel: 'Delete document',
      danger: true,
      action: async () => {
        await draft.flush();
        manager.cancelDocument(doc.id);
        await store.deleteDocument(doc.id);
        navigate({ name: 'home' });
        notify('Document deleted.', 'success');
        await refreshStorage();
      },
    });
  };

  const saveVersion = async (label?: string) => {
    if (!activeDocRef.current) return;
    try {
      await draft.flush();
      await store.createVersion(activeDocRef.current.id, label);
      notify('Version saved.', 'success');
    } catch (error) {
      notify(describeStorageError(error), 'error');
    }
  };

  const restoreVersion = async (version: Version) => {
    try {
      await draft.flush();
      const result = await store.restoreVersion(version.id);
      draft.replaceText(result.text);
      notify('Version restored. A snapshot of the previous draft was saved first.', 'success');
    } catch (error) {
      notify(describeStorageError(error), 'error');
    }
  };

  const deleteVersion = async (version: Version) => {
    try {
      await store.deleteVersion(version.id);
      notify('Version deleted.', 'success');
    } catch (error) {
      notify(describeStorageError(error), 'error');
    }
  };

  const editNudger = (nudger: Nudger) => setEditor({ mode: 'edit', initial: { ...nudger } });

  const startFromTemplate = (template: Template, blank = false) => {
    if (!settingsRef.current) return;
    const now = Date.now();
    const maxOrder = nudgersRef.current.reduce((max, nudger) => Math.max(max, nudger.order), -1);
    const base = nudgerFromTemplate(template, {
      order: maxOrder + 1,
      settings: settingsRef.current,
      fileIds: [],
    });
    setEditor({
      mode: 'create',
      initial: {
        id: `draft-${now}`,
        createdAt: now,
        updatedAt: now,
        ...base,
        ...(blank ? { templateId: undefined } : {}),
      },
    });
    setAddOpen(false);
  };

  const saveNudger = async (value: Nudger) => {
    try {
      if (editor?.mode === 'create') {
        const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = value;
        void _id;
        void _createdAt;
        void _updatedAt;
        await store.createNudger(rest);
        notify('Nudger created.', 'success');
      } else {
        await store.updateNudger(value.id, value);
        notify('Nudger saved.', 'success');
      }
      setEditor(null);
    } catch (error) {
      notify(describeStorageError(error), 'error');
    }
  };

  const saveNudgerAsTemplate = async (value: Nudger) => {
    try {
      await store.saveTemplate({
        id: newId(),
        name: `${value.name} template`,
        description: value.description ?? '',
        system: value.system,
        prompt: value.prompt,
        builtin: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      notify('Saved as a custom template. Manage it on the Templates page.', 'success');
    } catch (error) {
      notify(describeStorageError(error), 'error');
    }
  };

  const duplicateNudgerAsNew = async (value: Nudger) => {
    try {
      const {
        id: _id,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        order: _order,
        ...rest
      } = value;
      void _id;
      void _createdAt;
      void _updatedAt;
      void _order;
      await store.createNudger({
        ...rest,
        name: `${value.name} (copy)`,
        autoRun: false,
        done: false,
        budget: 3,
      });
      setEditor(null);
      notify('Copied as a new nudger.', 'success');
    } catch (error) {
      notify(describeStorageError(error), 'error');
    }
  };

  const duplicateNudger = async (nudger: Nudger) => {
    try {
      const copy = await store.duplicateNudger(nudger.id);
      if (copy) notify(`Duplicated as “${copy.name}”.`, 'success');
    } catch (error) {
      notify(describeStorageError(error), 'error');
    }
  };

  const deleteNudger = (nudger: Nudger) => {
    const replyCount = repliesRef.current.filter((reply) => reply.nudgerId === nudger.id).length;
    setConfirm({
      title: `Delete “${nudger.name}”?`,
      message: `This deletes the nudger and its reply history${replyCount ? ` (${replyCount} repl${replyCount === 1 ? 'y' : 'ies'} on this document)` : ''}. Other nudgers and documents are unchanged.`,
      confirmLabel: 'Delete nudger',
      danger: true,
      action: async () => {
        manager.cancel(nudger.id);
        await store.deleteNudger(nudger.id);
        if (previewNudgerId === nudger.id) setPreviewNudgerId(null);
        if (focusedNudgerId === nudger.id) setFocusedNudgerId(null);
        notify('Nudger deleted.', 'success');
      },
    });
  };

  const updateNudger = async (nudger: Nudger, patch: Partial<Nudger>) => {
    try {
      if ((patch.done === true || patch.enabled === false) && manager.isBusy(nudger.id)) {
        manager.cancel(nudger.id);
      }
      await store.updateNudger(nudger.id, patch);
    } catch (error) {
      notify(describeStorageError(error), 'error');
    }
  };

  const clearHistory = (nudger: Nudger) => {
    const doc = activeDocRef.current;
    if (!doc) return;
    setConfirm({
      title: `Clear ${nudger.name} history?`,
      message:
        'This deletes every saved reply from this nudger for this document and resets its budget count. Other documents keep their own reply histories.',
      confirmLabel: 'Clear history',
      danger: true,
      action: async () => {
        await store.clearReplyHistory(doc.id, nudger.id);
        notify('Reply history cleared.', 'success');
      },
    });
  };

  const setReplyStatus = async (reply: Reply, status: ReplyStatus) => {
    try {
      await store.setReplyStatus(reply.id, status);
    } catch (error) {
      notify(describeStorageError(error), 'error');
    }
  };

  const saveSettings = async (patch: Partial<Settings>) => {
    if (apiKeyRef.current && patch.rememberKey !== undefined) {
      // Saving settings is an explicit user action: honour the storage choice.
      saveApiKey(apiKeyRef.current, patch.rememberKey);
    }
    await store.saveSettings(patch);
  };

  const saveKey = async (key: string, remember: boolean) => {
    saveApiKey(key, remember);
    setApiKey(key);
    if (settingsRef.current && settingsRef.current.rememberKey !== remember) {
      await store.saveSettings({ rememberKey: remember });
    }
  };

  const removeKey = () => {
    clearApiKey();
    setApiKey('');
  };

  const clearAllData = async (removeKey: boolean) => {
    await draft.flush();
    manager.cancelAll();
    await store.clearAllData();
    if (removeKey) {
      clearApiKey();
      setApiKey('');
    } else if (apiKeyRef.current) {
      saveApiKey(apiKeyRef.current, false);
    }
    navigate({ name: 'home' });
    await refreshStorage();
    notify('All local data cleared.', 'success');
  };

  const exportData = async () => {
    try {
      await draft.flush();
      const bundle = await store.exportAll();
      downloadText(exportFileName(), JSON.stringify(bundle, null, 2), 'application/json');
      notify('Export downloaded. API keys are excluded.', 'success');
    } catch (error) {
      notify(describeStorageError(error), 'error');
    }
  };

  const executeConfirm = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      await confirm.action();
      setConfirm(null);
    } catch (error) {
      notify(describeStorageError(error), 'error');
    } finally {
      setConfirmBusy(false);
    }
  };

  const openImport = () => {
    void draft.flush();
    setImportOpen(true);
  };

  const handleImported = (_summary: ImportSummary) => {
    void refreshStorage();
    navigate({ name: 'home' });
  };

  // -------------------------------------------------------------------- render

  const loading = !documents || !nudgers || !files || !templates || !settings || !versionCounts;
  if (loading) {
    return (
      <div className="boot">
        <span className="boot-mark">n</span>
        <p>Loading nudger…</p>
        <p className="field-note">
          If this stays here, IndexedDB may be blocked. nudger needs local browser storage.
        </p>
      </div>
    );
  }

  const replyList = replies ?? [];
  const versionList = versions ?? [];
  const hasKey = Boolean(apiKey);
  const activeSection =
    route.name === 'doc' ? 'doc' : route.name === 'files' ? 'files' : route.name === 'templates' ? 'templates' : route.name === 'settings' ? 'settings' : 'home';
  const previewNudger = previewNudgerId
    ? nudgers.find((nudger) => nudger.id === previewNudgerId)
    : undefined;
  const providerSummary = `${getProviderPreset(settings.providerId).label} · ${settings.model || 'no model'}`;

  return (
    <div className="app-shell">
      <Sidebar
        documents={documents}
        versionCounts={versionCounts}
        activeDocId={activeDoc?.id ?? null}
        fileCount={files.length}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNavigate={closeOnNarrow}
        onNewDocument={() => void newDocument()}
        onExport={() => void exportData()}
        onImport={openImport}
        storage={storage}
        activeSection={activeSection}
      />

      <div className="main-shell">
        {route.name === 'home' ? (
          documents.length === 0 ? (
            <Welcome
              onNewDocument={() => void newDocument()}
              onOpenSettings={() => navigate({ name: 'settings' })}
              onOpenFiles={() => navigate({ name: 'files' })}
              hasKey={hasKey}
            />
          ) : (
            <div className="boot">
              <p>Opening your most recent document…</p>
            </div>
          )
        ) : null}

        {route.name === 'doc' ? (
          activeDoc ? (
            <DocumentView
              doc={activeDoc}
              text={draft.text}
              caret={caret}
              saving={draft.saving}
              versionCount={versionCounts[activeDoc.id] ?? 0}
              hasKey={hasKey}
              providerSummary={providerSummary}
              layout={settings.layout}
              onToggleSidebar={() => setSidebarOpen((value) => !value)}
              onChangeText={draft.change}
              onCaret={setCaret}
              onRename={(title) => void renameActive(title)}
              onSaveVersion={() => setSaveVersionOpen(true)}
              onOpenVersions={() => setVersionsOpen(true)}
              onDuplicate={() => void duplicateActive()}
              onDelete={deleteActive}
              onOpenSettings={() => navigate({ name: 'settings' })}
              nudgers={nudgers}
              files={files}
              replies={replyList}
              templates={templates}
              runStates={runStates}
              focusedNudgerId={focusedNudgerId}
              onFocusNudger={setFocusedNudgerId}
              onRunNudger={(nudger) => void runNudger(nudger, { source: 'manual' })}
              onCancelNudger={(id) => manager.cancel(id)}
              onRunAll={() => runAllRef.current()}
              onAddNudger={() => setAddOpen(true)}
              onEditNudger={editNudger}
              onPreviewNudger={(nudger) => setPreviewNudgerId(nudger.id)}
              onDuplicateNudger={(nudger) => void duplicateNudger(nudger)}
              onDeleteNudger={deleteNudger}
              onMoveNudger={(nudger, direction) => void store.moveNudger(nudger.id, direction)}
              onUpdateNudger={(nudger, patch) => void updateNudger(nudger, patch)}
              onClearHistory={clearHistory}
              onReplyStatus={(reply, status) => void setReplyStatus(reply, status)}
              onRetryNudger={(nudger) => void runNudger(nudger, { source: 'manual' })}
              onAddFromTemplate={(template) => startFromTemplate(template)}
            />
          ) : (
            <div className="boot">
              <p>This document no longer exists.</p>
              <button type="button" className="btn" onClick={() => navigate({ name: 'home' })}>
                Go home
              </button>
            </div>
          )
        ) : null}

        {route.name === 'files' ? (
          <FilesPage
            files={files}
            nudgers={nudgers}
            templates={templates}
            onToggleSidebar={() => setSidebarOpen((value) => !value)}
          />
        ) : null}

        {route.name === 'templates' ? (
          <TemplatesPage
            templates={templates}
            settings={settings}
            document={
              activeDoc
                ? { id: activeDoc.id, title: activeDoc.title, currentText: draft.text }
                : null
            }
            caret={caret}
            onToggleSidebar={() => setSidebarOpen((value) => !value)}
            onUseTemplate={(template) => startFromTemplate(template)}
          />
        ) : null}

        {route.name === 'settings' ? (
          <SettingsPage
            settings={settings}
            apiKey={apiKey}
            storage={storage}
            onToggleSidebar={() => setSidebarOpen((value) => !value)}
            onSave={saveSettings}
            onSaveKey={saveKey}
            onClearKey={removeKey}
            onClearAll={clearAllData}
            onExport={() => void exportData()}
            onImport={openImport}
          />
        ) : null}
      </div>

      {previewNudger && activeDoc ? (
        <PromptPreview
          nudger={previewNudger}
          document={{ id: activeDoc.id, title: activeDoc.title, currentText: draft.text }}
          caret={caret}
          files={files}
          settings={settings}
          hasKey={hasKey}
          onClose={() => setPreviewNudgerId(null)}
          onRun={(options) => {
            const nudger = previewNudger;
            setPreviewNudgerId(null);
            void runNudger(nudger, {
              source: 'manual',
              force: options.force,
              trim: options.trim,
            });
          }}
        />
      ) : null}

      {editor ? (
        <NudgerEditor
          mode={editor.mode}
          initial={editor.initial}
          files={files}
          templates={templates}
          settings={settings}
          document={
            activeDoc ? { id: activeDoc.id, title: activeDoc.title, currentText: draft.text } : null
          }
          caret={caret}
          onClose={() => setEditor(null)}
          onSave={saveNudger}
          onSaveAsTemplate={saveNudgerAsTemplate}
          onDuplicateAsNew={duplicateNudgerAsNew}
        />
      ) : null}

      {addOpen ? (
        <AddNudgerModal
          templates={templates}
          onPick={(template) => startFromTemplate(template)}
          onBlank={() => startFromTemplate(blankTemplate(), true)}
          onClose={() => setAddOpen(false)}
        />
      ) : null}

      {versionsOpen && activeDoc ? (
        <VersionDrawer
          doc={activeDoc}
          versions={versionList}
          onClose={() => setVersionsOpen(false)}
          onRestore={restoreVersion}
          onDelete={deleteVersion}
        />
      ) : null}

      {saveVersionOpen && activeDoc ? (
        <SaveVersionModal onClose={() => setSaveVersionOpen(false)} onSave={saveVersion} />
      ) : null}

      {importOpen ? (
        <ImportDialog
          currentSettings={settings}
          onClose={() => setImportOpen(false)}
          onBeforeImport={async () => {
            manager.cancelAll();
            await draft.flush();
          }}
          onImported={handleImported}
        />
      ) : null}

      {confirm ? (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          danger={confirm.danger}
          busy={confirmBusy}
          onClose={() => setConfirm(null)}
          onConfirm={() => void executeConfirm()}
        />
      ) : null}
    </div>
  );
}
