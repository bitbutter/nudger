export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'groq'
  | 'deepseek'
  | 'mistral'
  | 'openai-compatible'
  | 'custom';

export type Theme = 'dark' | 'light';
export type Layout = 'stacked' | 'side';

export type Document = {
  id: string;
  title: string;
  currentText: string;
  createdAt: number;
  updatedAt: number;
};

export type Version = {
  id: string;
  documentId: string;
  text: string;
  label?: string;
  createdAt: number;
  wordCount: number;
};

export type ReferenceFile = {
  id: string;
  name: string;
  kind: 'txt' | 'md';
  content: string;
  createdAt: number;
  updatedAt: number;
  wordCount: number;
};

export type Nudger = {
  id: string;
  /** The document this nudger belongs to. Nudgers do not travel between documents. */
  documentId: string;
  name: string;
  description?: string;
  color: string;
  system: string;
  prompt: string;
  fileIds: string[];
  /** Optional per-nudger provider/model override. The API key still comes from Settings. */
  providerId?: ProviderId;
  model?: string;
  temperature: number;
  maxTokens: number;
  maxContextChars: number;
  autoRun: boolean;
  /** Temporarily disabled: not run by hand, by Run all, or by auto-run. */
  enabled: boolean;
  /** Done stops generation for this nudger until reopened. */
  done: boolean;
  /** Reply allowance inside this document. "More" adds 3. */
  budget: number;
  /** Ask for a "Facts to check" list under each reply. Off by default. */
  facts: boolean;
  /** The role-specific focus for the fact-clue list; the output format is fixed. */
  factsPrompt: string;
  order: number;
  /** Starter or custom template this nudger was created from, for "reset to starter". */
  templateId?: string;
  createdAt: number;
  updatedAt: number;
};

export type ReplyStatus = 'new' | 'pinned' | 'dismissed' | 'archived';

export type Reply = {
  id: string;
  documentId: string;
  nudgerId: string;
  text: string;
  /** Exact system + user prompt sent for this reply. Immutable. */
  resolvedPrompt: string;
  fileIds: string[];
  model: string;
  provider: string;
  createdAt: number;
  status: ReplyStatus;
  error?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  /** Model-generated specifics to verify; never treated as verified facts. */
  facts?: string[];
  /** Set only when a fact list was requested but could not be produced. */
  factsError?: string;
};

export type Template = {
  id: string;
  name: string;
  description: string;
  system: string;
  prompt: string;
  /** Optional defaults carried into nudgers created from this template. */
  facts?: boolean;
  factsPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  maxContextChars?: number;
  builtin: boolean;
  createdAt: number;
  updatedAt: number;
};

export type Settings = {
  providerId: ProviderId;
  model: string;
  baseUrl: string;
  /** Never written to IndexedDB or exports. Held in memory / session / localStorage. */
  apiKey?: string;
  customHeaders?: Record<string, string>;
  rememberKey: boolean;
  temperature: number;
  maxTokens: number;
  maxContextChars: number;
  autoRunDelayMs: number;
  maxConcurrentRuns: number;
  requestTimeoutMs: number;
  theme: Theme;
  layout: Layout;
};

export type ExportedBundle = {
  app: 'nudger';
  schemaVersion: 1 | 2;
  exportedAt: number;
  documents: Document[];
  versions: Version[];
  files: ReferenceFile[];
  nudgers: Nudger[];
  replies: Reply[];
  templates: Template[];
  settings: Omit<Settings, 'apiKey'>;
};

export type Caret = { start: number; end: number };
