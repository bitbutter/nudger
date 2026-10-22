import { describe, expect, it } from 'vitest';
import {
  buildFactsInstruction,
  GENERIC_FACTS_FOCUS,
  parseStructuredNudge,
} from '../lib/facts';

describe('fact protocol', () => {
  it('builds one JSON response protocol with the focus', () => {
    const instruction = buildFactsInstruction('Focus on dates in the posting.');
    expect(instruction).toContain('FACT CLUES PROTOCOL');
    expect(instruction).toContain('Focus on dates in the posting.');
    expect(instruction).toContain('{"reply":"<your full reply>","facts":["clue one","clue two"]}');
    expect(instruction).toContain('up to five');
    expect(instruction).toContain('Return exactly one JSON object');
    expect(instruction).toContain('never invent');
  });

  it('falls back to the generic focus', () => {
    expect(buildFactsInstruction('   ')).toContain(GENERIC_FACTS_FOCUS);
  });
});

describe('structured reply parsing', () => {
  it('parses one object containing reply and facts', () => {
    expect(parseStructuredNudge('{"reply":"A question?","facts":["400 tickets","nine hours"]}')).toEqual({
      text: 'A question?',
      facts: ['400 tickets', 'nine hours'],
    });
  });

  it('handles fences and prose around the object', () => {
    expect(
      parseStructuredNudge('Here:\n```json\n{"reply":"A question?","facts":["four"]}\n```'),
    ).toEqual({ text: 'A question?', facts: ['four'] });
  });

  it('accepts nudge, string facts, and empty fact arrays', () => {
    expect(parseStructuredNudge('{"nudge":"A question?","facts":"a | b"}')).toEqual({
      text: 'A question?',
      facts: ['a', 'b'],
    });
    expect(parseStructuredNudge('{"reply":"A question?","facts":[]}')).toEqual({
      text: 'A question?',
      facts: [],
    });
  });

  it('recovers a reply from the old trailing FACTS convention', () => {
    expect(parseStructuredNudge('A useful question.\nFACTS: 400 tickets | nine hours')).toEqual({
      text: 'A useful question.',
      facts: ['400 tickets', 'nine hours'],
    });
  });

  it('keeps a plain-text reply and marks the structured list missing', () => {
    const parsed = parseStructuredNudge('A plain useful question.');
    expect(parsed.text).toBe('A plain useful question.');
    expect(parsed.facts).toEqual([]);
    expect(parsed.factsError).toMatch(/plain reply/i);
    expect(parsed.malformedJson).toBeUndefined();
  });

  it('rejects malformed JSON instead of showing it as prose', () => {
    const parsed = parseStructuredNudge('{"reply":"unterminated');
    expect(parsed.malformedJson).toBe(true);
    expect(parsed.text).toBe('');
  });

  it('rejects a JSON object with facts but no reply', () => {
    const parsed = parseStructuredNudge('{"facts":["one"]}');
    expect(parsed.malformedJson).toBe(true);
    expect(parsed.text).toBe('');
  });

  it('normalizes, deduplicates, and caps facts at five', () => {
    const parsed = parseStructuredNudge(
      '{"reply":"R","facts":["  alpha  ","Alpha","none","beta","gamma","delta","epsilon","zeta"]}',
    );
    expect(parsed.text).toBe('R');
    expect(parsed.facts).toEqual(['alpha', 'beta', 'gamma', 'delta', 'epsilon']);
  });
});
