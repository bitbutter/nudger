import type { Nudger, Settings, Template } from '../types';
import { GENERIC_FACTS_FOCUS } from './facts';
import { DEFAULT_MAX_TOKENS } from './defaults';

export const NUDGER_COLORS = [
  { value: '#7aa2f7', name: 'Blue' },
  { value: '#bb9af7', name: 'Violet' },
  { value: '#7dcfff', name: 'Cyan' },
  { value: '#9ece6a', name: 'Green' },
  { value: '#e0af68', name: 'Amber' },
  { value: '#f7768e', name: 'Rose' },
  { value: '#ff9e64', name: 'Orange' },
  { value: '#73daca', name: 'Teal' },
];

export const DEFAULT_NUDGER_COLOR = NUDGER_COLORS[0].value;

const STARTER_STAMP = 0;

/**
 * The read-only starter library. Editing a nudger never edits these; users can
 * duplicate a starter into a custom template. Each file-dependent starter says
 * so in its description.
 */
export const STARTER_TEMPLATES: Template[] = [
  {
    id: 'starter-completeness-coach',
    name: 'Completeness coach',
    description:
      'Compares your draft with the attached notes and asks for missing facts, names, numbers, examples or links. Attach your notes file.',
    system:
      'You are a completeness coach. Name the two most important specifics the attached notes contain but the draft leaves out, as short questions.',
    prompt: 'Reference notes:\n{{files}}\n\nDraft:\n{{before_cursor}}',
    facts: true,
    factsPrompt:
      "Focus on specifics in the reference notes that are missing from the draft: names, numbers, dates, examples or links the writer should include or verify.",
    builtin: true,
    createdAt: STARTER_STAMP,
    updatedAt: STARTER_STAMP,
  },
  {
    id: 'starter-hiring-manager',
    name: 'Hiring manager',
    description:
      'Reads your draft as the hiring manager for the attached job posting and asks what they would want to know next. Attach the job posting file.',
    system:
      'You are the hiring manager for the role in the attached posting, reading this application. Ask the two questions that would most change your decision.',
    prompt: 'Job posting:\n{{files}}\n\nApplication draft:\n{{before_cursor}}',
    facts: true,
    factsPrompt:
      "Focus on concrete requirements, dates, names or numbers in the job posting that the application draft does not address or should verify.",
    builtin: true,
    createdAt: STARTER_STAMP,
    updatedAt: STARTER_STAMP,
  },
  {
    id: 'starter-skeptical-reviewer',
    name: 'Skeptical reviewer',
    description:
      'Finds the weakest claim, missing evidence or ambiguity and asks one specific question. No files needed.',
    system:
      'You are a skeptical but fair reviewer. Name the weakest claim in the draft and ask the one question that would resolve it.',
    prompt: 'Draft:\n{{before_cursor}}',
    facts: true,
    factsPrompt:
      "Focus on the specific evidence, numbers or names behind the weakest claim that the writer should verify before relying on it.",
    builtin: true,
    createdAt: STARTER_STAMP,
    updatedAt: STARTER_STAMP,
  },
  {
    id: 'starter-structural-editor',
    name: 'Structural editor',
    description:
      'Describes the current structure and says what the next paragraph should accomplish. Attach an outline or style guide if you have one.',
    system:
      'You are a structural editor. Say what the next paragraph has to accomplish, in one sentence.',
    prompt:
      'Reference outline or style guide (optional):\n{{files}}\n\nDraft so far:\n{{before_cursor}}',
    facts: false,
    builtin: true,
    createdAt: STARTER_STAMP,
    updatedAt: STARTER_STAMP,
  },
  {
    id: 'starter-fact-checker',
    name: 'Fact checker',
    description:
      'Flags claims that need a source and what kind of source would settle each. Attach a sources file if you keep one.',
    system:
      'You are a fact checker. Name the claims that need a source and the kind of source that would settle each.',
    prompt: 'Known sources (optional):\n{{files}}\n\nDraft:\n{{before_cursor}}',
    facts: false,
    factsPrompt:
      "Focus on claims in the draft that need a source, naming the specific name, date, number or claim the writer should check. Do not verify them yourself.",
    builtin: true,
    createdAt: STARTER_STAMP,
    updatedAt: STARTER_STAMP,
  },
  {
    id: 'starter-devils-advocate',
    name: "Devil's advocate",
    description:
      'Makes the strongest opposing case to the draft and states what evidence would change its mind. No files needed.',
    system:
      "You are a devil's advocate. Make the strongest opposing case to the draft in one sentence, then name the evidence that would change your mind in the second.",
    prompt: 'Draft:\n{{before_cursor}}',
    facts: false,
    builtin: true,
    createdAt: STARTER_STAMP,
    updatedAt: STARTER_STAMP,
  },
  {
    id: 'starter-audience-check',
    name: 'Audience check',
    description:
      'Says whether a smart non-specialist would follow the text, and points to jargon or unclear references. No files needed.',
    system:
      'You are a smart non-specialist reader. Say whether you follow the draft and quote the phrase that lost you.',
    prompt: 'Draft:\n{{before_cursor}}',
    facts: false,
    builtin: true,
    createdAt: STARTER_STAMP,
    updatedAt: STARTER_STAMP,
  },
  {
    id: 'starter-continuation-prompter',
    name: 'Continuation prompter',
    description:
      'Asks one question whose answer would decide what you write next. No files needed.',
    system:
      'You help a writer decide what comes next. Ask the one question whose answer decides the next paragraph.',
    prompt: 'Draft so far:\n{{before_cursor}}',
    facts: false,
    builtin: true,
    createdAt: STARTER_STAMP,
    updatedAt: STARTER_STAMP,
  },
  {
    id: 'starter-research-planner',
    name: 'Research planner',
    description:
      'Lists what still needs research or verification, in priority order. No files needed.',
    system:
      'You are a research planner. Name what still needs research or verification, in the order it blocks the draft.',
    prompt: 'Draft:\n{{before_cursor}}',
    facts: false,
    builtin: true,
    createdAt: STARTER_STAMP,
    updatedAt: STARTER_STAMP,
  },
  {
    id: 'starter-definition-explainer',
    name: 'Definition explainer',
    description:
      'Finds terms and assumptions a new reader may not share, and says what each one needs. No files needed.',
    system:
      'You are a careful editor. Name the terms and assumptions a new reader would not share, and what each one needs.',
    prompt: 'Draft:\n{{before_cursor}}',
    facts: false,
    builtin: true,
    createdAt: STARTER_STAMP,
    updatedAt: STARTER_STAMP,
  },
];

export const DEFAULT_TEMPLATE_ID = 'starter-skeptical-reviewer';

export function getTemplateById(id: string | undefined, custom: Template[] = []): Template | undefined {
  if (!id) return undefined;
  return STARTER_TEMPLATES.find((t) => t.id === id) ?? custom.find((t) => t.id === id);
}

export function blankTemplate(): Template {
  const now = Date.now();
  return {
    id: `template-${now}`,
    name: 'Untitled template',
    description: '',
    system: 'You are a careful reader. Ask what is missing or unclear.',
    prompt: 'Draft:\n{{before_cursor}}',
    builtin: false,
    createdAt: now,
    updatedAt: now,
  };
}

export type NewNudgerOptions = {
  /** The document that owns the new nudger. */
  documentId: string;
  order: number;
  settings: Pick<Settings, 'maxContextChars'>;
  fileIds?: string[];
  name?: string;
  template?: Template;
};

export function nudgerFromTemplate(template: Template, options: NewNudgerOptions): Omit<Nudger, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    documentId: options.documentId,
    name: options.name?.trim() || template.name,
    description: template.description,
    color: NUDGER_COLORS[Math.max(0, options.order) % NUDGER_COLORS.length].value,
    system: template.system,
    prompt: template.prompt,
    fileIds: options.fileIds ?? [],
    temperature: template.temperature ?? 0.4,
    maxTokens: template.maxTokens ?? DEFAULT_MAX_TOKENS,
    maxContextChars: template.maxContextChars ?? options.settings.maxContextChars,
    autoRun: true,
    enabled: true,
    done: false,
    facts: template.facts === true,
    factsPrompt: template.factsPrompt?.trim() || GENERIC_FACTS_FOCUS,
    order: options.order,
    templateId: template.id,
  };
}

type TemplateSource = Pick<
  Nudger,
  | 'name'
  | 'description'
  | 'system'
  | 'prompt'
  | 'temperature'
  | 'maxTokens'
  | 'maxContextChars'
  | 'facts'
  | 'factsPrompt'
>;

/**
 * Turns a configured nudger into a template. Prompts are copied verbatim, so
 * placeholders keep resolving against whichever document later uses it. Files
 * are deliberately not carried: they belong to the document's context.
 */
export function templateFromNudger(
  nudger: TemplateSource,
  options: { id?: string; now?: number; name?: string } = {},
): Template {
  const now = options.now ?? Date.now();
  return {
    id: options.id ?? `template-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: (options.name ?? `${nudger.name} template`).trim() || 'Untitled template',
    description: nudger.description ?? '',
    system: nudger.system,
    prompt: nudger.prompt,
    facts: nudger.facts === true,
    factsPrompt: nudger.factsPrompt,
    temperature: nudger.temperature,
    maxTokens: nudger.maxTokens,
    maxContextChars: nudger.maxContextChars,
    builtin: false,
    createdAt: now,
    updatedAt: now,
  };
}
