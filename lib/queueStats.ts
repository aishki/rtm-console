import { thrOf } from "./engine/rules";
import type { Level } from "./ui/palette";
import type { Queue, QueueCounts, Rule } from "./types";

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

/** How each call number reads against its threshold. Shared by the KPI tiles and the agent grid rows so they can't drift. */
export function queueLevels(q: Queue, rules: Rule[]): Record<"cq" | "sl" | "asa" | "ab", Level> {
  const cq = thrOf(rules, "cq"), sl = thrOf(rules, "sl"), ab = thrOf(rules, "aband");
  return {
    cq: q.cq > cq ? "crit" : q.cq > cq - 3 ? "warn" : "ok",
    sl: q.sl === null ? "ok" : q.sl < sl ? "crit" : q.sl < sl + 5 ? "warn" : "ok",
    asa: q.asa > 45 ? "warn" : "ok",
    ab: q.ab > ab ? "crit" : q.ab > ab - 1.5 ? "warn" : "ok",
  };
}
