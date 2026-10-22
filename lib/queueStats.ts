import type { Queue, QueueCounts } from "./types";

/** Queue names match between sheet and Genesys ignoring case and surrounding spaces. */
export const queueKey = (name: string): string => name.trim().toUpperCase();

const sum = (xs: QueueCounts[], f: (x: QueueCounts) => number): number => xs.reduce((s, x) => s + f(x), 0);

/**
 * One set of numbers from a group of queues, weighted by calls rather than averaged per queue,
 * so a queue with 7 calls does not count as much as one with 700. Service level is null when no
 * queue counted a call yet: "no data", not 0%. Null when no queue reports.
 */
export function rollUp(counts: QueueCounts[]): Queue | null {
  if (counts.length === 0) return null;
  const offered = sum(counts, c => c.offered), abandoned = sum(counts, c => c.abandoned);
  const answered = sum(counts, c => c.answered), counted = sum(counts, c => c.slCounted);
  return {
    cq: sum(counts, c => c.waiting),
    sl: counted > 0 ? (sum(counts, c => c.slWithin) / counted) * 100 : null,
    asa: answered > 0 ? sum(counts, c => c.answerSec) / answered : 0,
    ab: offered > 0 ? (abandoned / offered) * 100 : 0,
  };
}
