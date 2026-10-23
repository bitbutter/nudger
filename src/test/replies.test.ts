import { describe, expect, it } from 'vitest';
import type { Reply } from '../types';
import { dismissStartsNewNudge, newestFirst, newestReply } from '../lib/replies';
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

describe('dismiss starts a new nudge', () => {
  const newest = reply('newest', 3);
  const older = reply('older', 1);
  const otherNudger = reply('other', 2, 'nudger-2');

  it('is true only for the newest reply of that nudger', () => {
    const replies = [newest, otherNudger, older];
    expect(dismissStartsNewNudge(replies, newest)).toBe(true);
    expect(dismissStartsNewNudge(replies, older)).toBe(false);
  });

  it('is true for the only reply', () => {
    expect(dismissStartsNewNudge([older], older)).toBe(true);
    expect(dismissStartsNewNudge([], older)).toBe(false);
  });

  it('ignores another nudger being newer', () => {
    expect(dismissStartsNewNudge([reply('later', 9, 'nudger-2'), older], older)).toBe(true);
  });
});
