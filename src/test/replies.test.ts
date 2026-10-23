import { describe, expect, it } from 'vitest';
import type { Reply } from '../types';
import {
  AVOID_LIMIT,
  AVOID_MAX_AGE_MS,
  AVOID_TEXT_LIMIT,
  collectAvoid,
  newestFirst,
  newestReply,
} from '../lib/replies';
import { testReplyInput } from './helpers';

function reply(id: string, createdAt: number, nudgerId = 'nudger-1'): Reply {
  return {
    ...testReplyInput('doc-1', nudgerId, id),
    id,
    createdAt,
    status: 'new',
  };
}

describe('reply ordering', () => {
  it('sorts newest first without touching the input', () => {
    const replies = [reply('old', 1), reply('new', 3), reply('middle', 2)];
    const ordered = newestFirst(replies);
    expect(ordered.map((item) => item.id)).toEqual(['new', 'middle', 'old']);
    expect(replies.map((item) => item.id)).toEqual(['old', 'new', 'middle']);
  });

  it('finds the newest reply of one nudger', () => {
    const replies = [reply('a-new', 5), reply('b-new', 9, 'nudger-2'), reply('a-old', 2)];
    expect(newestReply(replies, 'nudger-1')?.id).toBe('a-new');
    expect(newestReply(replies, 'nudger-2')?.id).toBe('b-new');
    expect(newestReply(replies, 'missing')).toBeNull();
  });
});

describe('do-not-raise list', () => {
  const now = 1_000_000_000_000;

  function rejected(id: string, text: string, dismissedAt = now, nudgerId = 'nudger-1'): Reply {
    return {
      ...reply(id, dismissedAt - 1000, nudgerId),
      text,
      status: 'dismissed',
      statusChangedAt: dismissedAt,
    };
  }

  it('collects only this nudger\u2019s dismissed replies, newest first', () => {
    const avoid = collectAvoid(
      [
        rejected('a', 'First rejected nudge.', now - 3000),
        rejected('b', 'Second rejected nudge.', now - 2000),
        rejected('c', 'Another nudger\u2019s nudge.', now, 'nudger-2'),
        { ...reply('d', now - 500), text: 'Still live nudge.' },
      ],
      'nudger-1',
      now,
    );
    expect(avoid).toEqual(['Second rejected nudge.', 'First rejected nudge.']);
  });

  it('drops a rejection once it is a week old', () => {
    const avoid = collectAvoid(
      [
        rejected('old', 'Stale rejection.', now - AVOID_MAX_AGE_MS - 1),
        rejected('fresh', 'Fresh rejection.', now - AVOID_MAX_AGE_MS + 1000),
      ],
      'nudger-1',
      now,
    );
    expect(avoid).toEqual(['Fresh rejection.']);
  });

  it('falls back to createdAt when a reply has no statusChangedAt', () => {
    const legacy: Reply = {
      ...reply('legacy', now - 60_000),
      text: 'Legacy rejection.',
      status: 'dismissed',
    };
    expect(collectAvoid([legacy], 'nudger-1', now)).toEqual(['Legacy rejection.']);
  });

  it('caps the list and clips each entry', () => {
    const many = Array.from({ length: AVOID_LIMIT + 3 }, (_unused, index) =>
      rejected(`r${index}`, `Nudge ${index}`, now - index * 1000),
    );
    const avoid = collectAvoid(many, 'nudger-1', now);
    expect(avoid).toHaveLength(AVOID_LIMIT);
    expect(avoid[0]).toBe('Nudge 0');

    const long = collectAvoid([rejected('long', 'x'.repeat(AVOID_TEXT_LIMIT + 50))], 'nudger-1', now);
    expect(long[0]).toHaveLength(AVOID_TEXT_LIMIT + 1);
    expect(long[0].endsWith('\u2026')).toBe(true);
  });

  it('forgets a point as soon as it is allowed again', () => {
    const allowed: Reply = { ...rejected('a', 'Maybe later.'), status: 'new' };
    expect(collectAvoid([allowed], 'nudger-1', now)).toEqual([]);
  });

  it('counts a repeated point once, so a model repeat cannot crowd out other rejections', () => {
    const avoid = collectAvoid(
      [
        rejected('repeat', 'Name the request count.', now),
        rejected('first', 'Name the request count.', now - 1000),
        rejected('other', 'Say who the letter is for.', now - 2000),
      ],
      'nudger-1',
      now,
    );
    expect(avoid).toEqual(['Name the request count.', 'Say who the letter is for.']);
  });
});
