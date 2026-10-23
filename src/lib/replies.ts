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

/** How many rejected nudges one nudger remembers. */
export const AVOID_LIMIT = 5;

/**
 * A rejection is forgotten after a week, so a nudger cannot be gagged forever
 * by advice that stopped applying when the draft moved on.
 */
export const AVOID_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Each remembered nudge is clipped, so the block stays a fixed small cost. */
export const AVOID_TEXT_LIMIT = 200;

/**
 * Comparison key for nudges: case, punctuation and spacing are ignored, so
 * "Clarify the timeline." and "clarify the timeline" are the same point.
 * Nothing fuzzier is attempted on purpose; close paraphrases are handled by the
 * prompt block, not by a similarity heuristic.
 */
export function nudgeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The do-not-raise list: the nudges the writer dismissed for this nudger,
 * newest first. They are sent with the next request so a dismissal means "do
 * not raise that again" instead of "say it again". Allowing a reply again
 * removes it from this list, because the filter reads the stored status.
 */
export function collectAvoid(replies: Reply[], nudgerId: string, now = Date.now()): string[] {
  const rejected = newestFirst(
    replies.filter((reply) => reply.nudgerId === nudgerId && reply.status === 'dismissed'),
  );
  const avoid: string[] = [];
  const seen = new Set<string>();
  for (const reply of rejected) {
    if (now - (reply.statusChangedAt ?? reply.createdAt) > AVOID_MAX_AGE_MS) continue;
    const text = reply.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    // A nudge the model repeated after it was rejected is stored as dismissed
    // too; it must not take up a slot next to the rejection it repeats.
    const key = nudgeKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    avoid.push(
      text.length > AVOID_TEXT_LIMIT ? `${text.slice(0, AVOID_TEXT_LIMIT).trimEnd()}…` : text,
    );
    if (avoid.length >= AVOID_LIMIT) break;
  }
  return avoid;
}
