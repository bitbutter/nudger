import { describe, expect, it } from 'vitest';
import { STARTER_TEMPLATES, getTemplateById, nudgerFromTemplate } from '../lib/starters';
import { hasContextPlaceholder } from '../lib/placeholders';
import { DEFAULT_SETTINGS } from '../lib/defaults';

describe('starter library', () => {
  it('ships the ten required starters with unique names and ids', () => {
    expect(STARTER_TEMPLATES).toHaveLength(10);
    expect(new Set(STARTER_TEMPLATES.map((t) => t.id)).size).toBe(10);
    expect(new Set(STARTER_TEMPLATES.map((t) => t.name)).size).toBe(10);
    const required = [
      'Completeness coach',
      'Hiring manager',
      'Skeptical reviewer',
      'Structural editor',
      'Fact checker',
      "Devil's advocate",
      'Audience check',
      'Continuation prompter',
      'Research planner',
      'Definition explainer',
    ];
    expect(STARTER_TEMPLATES.map((t) => t.name)).toEqual(required);
    expect(STARTER_TEMPLATES.every((t) => t.builtin)).toBe(true);
    expect(STARTER_TEMPLATES.every((t) => t.prompt.trim().length > 0)).toBe(true);
    expect(STARTER_TEMPLATES.every((t) => hasContextPlaceholder(t.prompt))).toBe(true);
  });

  it('says when a starter needs an attached file', () => {
    const coach = getTemplateById('starter-completeness-coach');
    const manager = getTemplateById('starter-hiring-manager');
    expect(coach?.description).toMatch(/attach your notes/i);
    expect(manager?.description).toMatch(/attach the job posting/i);
    expect(coach?.prompt).toContain('{{files}}');
    expect(manager?.prompt).toContain('{{files}}');
  });

  it('creates an independent nudger from a template', () => {
    const template = getTemplateById('starter-skeptical-reviewer')!;
    const nudger = nudgerFromTemplate(template, { order: 2, settings: DEFAULT_SETTINGS });
    expect(nudger.name).toBe('Skeptical reviewer');
    expect(nudger.templateId).toBe(template.id);
    expect(nudger.prompt).toBe(template.prompt);
    expect(nudger.system).toBe(template.system);
    expect(nudger.budget).toBe(3);
    expect(nudger.autoRun).toBe(false);
    expect(nudger.maxContextChars).toBe(DEFAULT_SETTINGS.maxContextChars);
    expect(nudger.description).toBe(template.description);
    expect(nudger.facts).toBe(true);
    expect(nudger.factsPrompt).toContain('evidence');
  });

  it('turns fact clues on only for fact-oriented starters', () => {
    const byName = Object.fromEntries(STARTER_TEMPLATES.map((template) => [template.name, template]));
    expect(byName['Completeness coach'].facts).toBe(true);
    expect(byName['Hiring manager'].facts).toBe(true);
    expect(byName['Skeptical reviewer'].facts).toBe(true);
    expect(byName['Fact checker'].facts).toBe(false);
    for (const name of [
      'Structural editor',
      "Devil's advocate",
      'Audience check',
      'Continuation prompter',
      'Research planner',
      'Definition explainer',
    ]) {
      expect(byName[name].facts).toBe(false);
    }
    expect(byName['Fact checker'].factsPrompt).toContain('need a source');
  });
});
