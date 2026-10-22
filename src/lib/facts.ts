/**
 * When fact clues are enabled, one request returns one JSON object containing
 * both the reply and the facts:
 *
 *   {"reply":"...","facts":["..."]}
 *
 * The nudge is never lost silently: a plain-text response is kept as the reply
 * (without facts), and a malformed JSON response is surfaced as a retryable
 * error rather than rendered as raw data.
 *
 * Facts are model-generated clues to verify, not verified facts.
 */

export const GENERIC_FACTS_FOCUS =
  'List the concrete details behind the question or critique in your reply: exact names, dates, numbers, versions, language/stack or links the writer should verify. Ignore material unrelated to that nudge.';

export function buildFactsInstruction(focus: string): string {
  return [
    'FACT CLUES PROTOCOL',
    `Focus: ${(focus || '').trim() || GENERIC_FACTS_FOCUS}`,
    'The facts are for the nudge you write in the reply field, not a general summary of the material. Return exactly one JSON object and nothing else:',
    '{"reply":"<your full reply>","facts":["clue one","clue two"]}',
    '- "reply" is the complete text you would otherwise have written to the writer. Keep your normal format, length and tone. Do not mention this JSON protocol in it. Escape line breaks as \\n.',
    '- "facts" contains up to five concrete specifics that relate directly to the nudge in "reply". They are the details behind that question or critique: exact names, dates, numbers, versions, language/stack, claims or links the writer should verify. If the nudge names a project, tool, paper or event, include its exact name, language/stack, release date, version, people or numbers when the material contains them. Every clue must help answer or check that nudge. Do not summarize the material and do not list unrelated facts. Use only the supplied material; never invent. Prefer exact values or short quotes. If a clue comes from a named file, include the file name in parentheses. Put the most relevant clue first. If no clue relates to the nudge, use [].',
    '- Return valid JSON with no markdown fences and no text outside the object.',
  ].join('\n');
}

function normalizeFacts(value: unknown): string[] {
  const list =
    typeof value === 'string' ? value.split(/\s*[|;]\s*/) : Array.isArray(value) ? value : [];
  if (!list.length) return [];
  const facts: string[] = [];
  for (const item of list) {
    let raw = '';
    if (typeof item === 'string') raw = item;
    else if (item && typeof item === 'object') {
      const record = item as { text?: unknown; fact?: unknown };
      if (typeof record.text === 'string') raw = record.text;
      else if (typeof record.fact === 'string') raw = record.fact;
    }
    const fact = raw.trim().replace(/^[-•]\s*/, '').slice(0, 300);
    if (!fact) continue;
    if (/^none\.?$/i.test(fact)) continue;
    if (facts.some((existing) => existing.toLowerCase() === fact.toLowerCase())) continue;
    facts.push(fact);
    if (facts.length >= 5) break;
  }
  return facts;
}

function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function decodeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replace(/\\n/g, '\n').replace(/\\"/g, '"');
  }
}

export type ParsedNudge = {
  text: string;
  facts: string[];
  /** Set when the reply was usable but no structured fact list was returned. */
  factsError?: string;
  /** Set when the response looked like JSON and could not be recovered. */
  malformedJson?: boolean;
};

export function parseStructuredNudge(raw: string): ParsedNudge {
  const text = raw.trim();
  if (!text) return { text: '', facts: [], malformedJson: true };

  const stripped = stripFences(text);
  const candidates = [stripped];
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(stripped.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const record = parsed as Record<string, unknown>;
      const reply =
        typeof record.reply === 'string'
          ? record.reply
          : typeof record.nudge === 'string'
            ? record.nudge
            : '';
      const hasFactsKey = Object.hasOwn(record, 'facts');
      const factsValue = record.facts;
      const facts = normalizeFacts(factsValue);
      if (reply.trim()) {
        if (!hasFactsKey) {
          return {
            text: reply.trim(),
            facts: [],
            factsError: 'The model omitted the fact list for this reply.',
          };
        }
        if (typeof factsValue !== 'string' && !Array.isArray(factsValue)) {
          return {
            text: reply.trim(),
            facts: [],
            factsError: 'The model returned an invalid fact list for this reply.',
          };
        }
        return { text: reply.trim(), facts };
      }
      if (facts.length > 0) return { text: '', facts, malformedJson: true };
    } catch {
      // Try the next candidate or the recovery paths.
    }
  }

  // A slightly malformed object can still contain a usable reply string.
  const replyMatch = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/s.exec(stripped);
  const nudgeMatch = /"nudge"\s*:\s*"((?:[^"\\]|\\.)*)"/s.exec(stripped);
  const recoveredReply = decodeJsonString((replyMatch ?? nudgeMatch)?.[1] ?? '');
  const factsMatch = /"facts"\s*:\s*\[([\s\S]*?)\]/.exec(stripped);
  if (recoveredReply.trim()) {
    const recoveredFacts = factsMatch
      ? normalizeFacts(
          [...factsMatch[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) =>
            decodeJsonString(match[1]),
          ),
        )
      : [];
    return {
      text: recoveredReply.trim(),
      facts: recoveredFacts,
      factsError: recoveredFacts.length ? undefined : 'The structured fact list could not be recovered.',
    };
  }

  // A reply cut off inside the JSON string can still be salvaged; the facts are
  // marked missing rather than failing the whole run.
  const partialMatch =
    /"reply"\s*:\s*"([\s\S]*)$/s.exec(stripped) ??
    /"nudge"\s*:\s*"([\s\S]*)$/s.exec(stripped);
  if (partialMatch) {
    const partial = decodeJsonString(partialMatch[1]);
    if (partial.trim()) {
      return {
        text: partial.trim(),
        facts: [],
        factsError:
          'The response was cut off before the fact list was complete. The reply may be incomplete.',
      };
    }
  }

  // The model ignored the JSON protocol but followed the trailing-line
  // convention. Only the final non-empty line is treated as the fact line, so
  // a legitimate "FACTS:" block mid-reply is not removed.
  const lines = stripped.split('\n');
  let last = lines.length - 1;
  while (last >= 0 && !lines[last].trim()) last -= 1;
  if (last >= 0 && /^\s*FACTS\s*:/i.test(lines[last])) {
    const value = lines[last].replace(/^\s*FACTS\s*:\s*/i, '').trim();
    const facts = /^none\.?$/i.test(value) ? [] : normalizeFacts(value.split(/\s*[|;]\s*/));
    const before = lines.slice(0, last).join('\n').trim();
    if (before) return { text: before, facts };
  }

  // If it was JSON-shaped, do not show a broken blob as prose.
  if (/^[{[]/.test(stripped)) {
    return { text: '', facts: [], malformedJson: true };
  }

  // Plain prose: preserve the nudge, report that the fact list is missing.
  return {
    text,
    facts: [],
    factsError: 'The model returned a plain reply without the structured fact list.',
  };
}
