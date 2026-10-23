import type { Reply } from '../types';

/**
 * Newest first. Storage already returns replies in this order; the sort keeps
 * the card and the run helpers independent of that detail.
 */
export function newestFirst(replies: Reply[]): Reply[] {
  return [...replies].sort((a, b) => b.createdAt - a.createdAt);
}

/** The newest reply of one nudger, whatever its status. */
export function newestReply(replies: Reply[], nudgerId: string): Reply | null {
  return newestFirst(replies.filter((reply) => reply.nudgerId === nudgerId))[0] ?? null;
}

/**
 * Dismissing the reply the card is showing asks for the next nudge. Dismissing
 * an older reply is triage, so it must not start extra runs.
 */
export function dismissStartsNewNudge(replies: Reply[], reply: Reply): boolean {
  return newestReply(replies, reply.nudgerId)?.id === reply.id;
}
