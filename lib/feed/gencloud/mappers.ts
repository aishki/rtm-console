import type { Team, RosterAgent, Queue, QueueCounts } from "@/lib/types";
import { rollUp } from "@/lib/queueStats";
import type { QueueObs, QueueAgg, QueueMember } from "./client";

/** Members whose account state the member record leaves out, to be checked against the users lookup. */
export const unknownStateIds = (membersByQueue: Record<string, QueueMember[]>): string[] =>
  [...new Set(Object.values(membersByQueue).flat().filter(m => m.state === undefined).map(m => m.id))];

/**
 * Drops deactivated and deleted accounts, which Genesys keeps as queue members. A member
 * without a state is kept only if the users lookup (`active`, the IDs it returned) has it;
 * `active` null means the lookup failed, and then they are kept rather than lose real agents.
 */
export function activeMembers(
  membersByQueue: Record<string, QueueMember[]>,
  active: Set<string> | null,
): Record<string, QueueMember[]> {
  const keep = (m: QueueMember) => (m.state === undefined ? active === null || active.has(m.id) : m.state === "active");
  return Object.fromEntries(Object.entries(membersByQueue).map(([q, ms]) => [q, ms.filter(keep)]));
}

/**
 * Drops accounts with no login in `days` days. Genesys keeps them active and on their queues
 * (70 in the watched view had not logged in for over a year on 9 Oct 2026), so they would sit
 * on the floor as Offline. A member without a last login is kept.
 */
export function recentMembers(
  membersByQueue: Record<string, QueueMember[]>,
  now: number,
  days: number,
): Record<string, QueueMember[]> {
  const cutoff = now - days * 86_400_000;
  const keep = (m: QueueMember) => {
    const t = m.lastLogin ? Date.parse(m.lastLogin) : NaN;
    return !Number.isFinite(t) || t >= cutoff;
  };
  return Object.fromEntries(Object.entries(membersByQueue).map(([q, ms]) => [q, ms.filter(keep)]));
}

export function buildRoster(
  queues: { id: string; name: string }[],
  membersByQueue: Record<string, { id: string; name: string }[]>,
): { org: Team[]; agents: RosterAgent[]; idToName: Record<string, string> } {
  const org: Team[] = [];
  const agents: RosterAgent[] = [];
  const idToName: Record<string, string> = {};
  const seen = new Set<string>();
  for (const q of queues) {
    org.push({ team: q.name, tl: "", mgr: "", lob: q.name });
    for (const m of membersByQueue[q.id] ?? []) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      idToName[m.id] = m.name;
      agents.push({ name: m.name, team: q.name, state: "off" });
    }
  }
  return { org, agents, idToName };
}

/** Raw per-queue counts from the observation and aggregate rows, keyed by queueId. */
export function toCounts(obs: QueueObs[], agg: QueueAgg[]): Record<string, QueueCounts> {
  const out: Record<string, QueueCounts> = {};
  const at = (id: string) => (out[id] ??= { waiting: 0, offered: 0, answered: 0, abandoned: 0, answerSec: 0, slWithin: 0, slCounted: 0 });
  for (const o of obs) at(o.queueId).waiting += o.waiting;
  for (const a of agg) {
    const c = at(a.queueId);
    c.offered += a.offered; c.answered += a.answered; c.abandoned += a.abandoned;
    c.answerSec += a.answerSec; c.slWithin += a.slWithin; c.slCounted += a.slCounted;
  }
  return out;
}

/** One set of floor numbers from every watched queue, call-weighted (see `rollUp`). */
export const aggregateQueue = (obs: QueueObs[], agg: QueueAgg[]): Queue =>
  rollUp(Object.values(toCounts(obs, agg))) ?? { cq: 0, sl: null, asa: 0, ab: 0 };
