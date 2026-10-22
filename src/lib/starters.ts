import type { Nudger, Settings, Template } from '../types';
import { GENERIC_FACTS_FOCUS } from './facts';

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
      'You are a completeness coach. Compare the draft with the attached reference notes. Your job is to surface specific information that is missing from the draft, not to write it. Do not rewrite the draft or suggest wording. Reply with up to five missing specifics, each naming the fact, figure, name, date, example or link and asking for it. If the notes add nothing that is missing, say so in one sentence. Use only the reference notes and the draft; never invent facts. Plain text, no headings.',
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
      "You are the hiring manager for the role described in the attached job posting, reading a candidate's draft application. Ask what you would want to know next. Do not rewrite the application. Name at most three important gaps between the posting and the draft, and ask one concrete question about each. If the draft covers the posting well, ask the single most useful next question. Use only the posting and the draft; do not invent requirements. Plain text.",
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
      'You are a skeptical but fair reviewer. Identify the weakest claim, the missing evidence or the most consequential ambiguity in the draft. Ask exactly one specific question that would resolve it. Do not rewrite the draft, do not suggest wording, and do not ask more than one question. Plain text, under 60 words.',
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
      'You are a structural editor. Describe the structure of the draft so far in two or three sentences. Then state what the next paragraph or section should accomplish, in terms of its job rather than its wording. Do not write the section, do not suggest sentences, and do not comment on style. If a reference outline or style guide is attached, check the draft against it. Plain text, under 120 words.',
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
      'You are a fact checker. List the claims in the draft that need a source before publication. For each claim, say what kind of source would settle it, such as a primary document, a dated statistic, a named expert or a dataset. Do not claim to verify anything you cannot verify, do not invent sources, and do not rewrite the draft. If the attached sources file already covers a claim, say so. At most five claims. Plain text.',
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
      "You are a devil's advocate. Make the strongest opposing case to the argument in the draft, in at most three sentences. Then state what evidence would change your mind. Do not attack the writer, do not rewrite the draft, and do not hedge into both-sides mush. If the draft makes no argument yet, say so and name the claim it seems to be building toward. Plain text.",
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
      'You are a smart non-specialist reader. Say in one sentence whether you would follow the draft. Then point to specific jargon, acronyms, unexplained references or assumed knowledge that lost you, quoting the exact phrase. Do not rewrite the draft and do not praise. At most five points. Plain text.',
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
      'You help a writer decide what comes next. Read the draft and ask one question whose answer would determine the next paragraph. Do not write the paragraph, do not offer a menu of options unless the choice is genuinely binary, and do not summarise the draft. Plain text, under 50 words.',
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
      'You are a research planner. From the draft, list what still needs research or verification, in priority order, with a one-line reason for each. At most six items. Do not do the research, do not invent findings, and do not rewrite the draft. Plain text.',
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
      'You are a careful editor. Identify the terms, acronyms and assumptions in the draft that a new reader might not share. For each, say in one line what the reader would need: a definition, a date, a link or a one-clause explanation. Do not rewrite the draft. At most five items. Plain text.',
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
    system: 'You are a careful reader. Ask about what is missing or unclear. Do not rewrite the draft.',
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
    maxTokens: template.maxTokens ?? 700,
    maxContextChars: template.maxContextChars ?? options.settings.maxContextChars,
    autoRun: false,
    enabled: true,
    done: false,
    budget: 3,
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
