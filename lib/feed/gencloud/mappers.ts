import type { Team, RosterAgent, Queue } from "@/lib/types";
import type { QueueObs, QueueAgg } from "./client";

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
