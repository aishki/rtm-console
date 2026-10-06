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

function avg(xs: (number | null)[]): number {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

export function aggregateQueue(obs: QueueObs[], agg: QueueAgg[]): Queue {
  const offered = agg.reduce((s, a) => s + a.offered, 0);
  const abandoned = agg.reduce((s, a) => s + a.abandoned, 0);
  return {
    cq: obs.reduce((s, o) => s + o.waiting, 0),
    sl: avg(obs.map((o) => o.serviceLevelPct)),
    asa: avg(agg.map((a) => a.asaSec)),
    ab: offered > 0 ? (abandoned / offered) * 100 : 0,
  };
}
