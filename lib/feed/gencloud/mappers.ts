import type { Team, RosterAgent, Queue } from "@/lib/types";
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

const sum = <T,>(xs: T[], f: (x: T) => number): number => xs.reduce((s, x) => s + f(x), 0);

/**
 * One set of floor numbers from every watched queue, weighted by calls rather than averaged
 * per queue, so a queue with 7 calls does not count as much as one with 700. Service level is
 * null when no queue counted a call yet: "no data", not 0%.
 */
export function aggregateQueue(obs: QueueObs[], agg: QueueAgg[]): Queue {
  const offered = sum(agg, a => a.offered), abandoned = sum(agg, a => a.abandoned);
  const answered = sum(agg, a => a.answered), counted = sum(agg, a => a.slCounted);
  return {
    cq: sum(obs, o => o.waiting),
    sl: counted > 0 ? (sum(agg, a => a.slWithin) / counted) * 100 : null,
    asa: answered > 0 ? sum(agg, a => a.answerSec) / answered : 0,
    ab: offered > 0 ? (abandoned / offered) * 100 : 0,
  };
}
