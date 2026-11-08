import type { AgentLeads, Incident, Instance } from "@/lib/types";
import { NO_LEADER } from "./format";

/** One row of the Dashboards "Breakdown by Team Lead" table. `queues`: where the Team Lead's agents sit, by name. */
export interface LeadRow { tl: string; mgr: string; agents: number; queues: string[]; n: number; l: number; o: number; ir: number; top: string }

/** The Team Lead and Manager names shown for an agent; NO_LEADER where Genesys and the directory have none. */
export function leadNames(l: AgentLeads | undefined): { tl: string; mgr: string } {
  if (!l?.tl) return { tl: NO_LEADER, mgr: "—" };
  return { tl: l.tl, mgr: l.mgr ?? NO_LEADER };
}

/** Team Leads by name, with agents who have none last. */
export const byLead = (a: { tl: string }, b: { tl: string }): number =>
  Number(a.tl === NO_LEADER) - Number(b.tl === NO_LEADER) || a.tl.localeCompare(b.tl);

/**
 * Each agent's queues by uid: their own team and every queue whose membership lists them,
 * sorted by name. `members` is queue name to agent ids, as the engine keeps it.
 */
export function agentQueues(agents: { id: number; uid: string; team: string }[], members: Record<string, number[]>): Map<string, string[]> {
  const byId = new Map<number, Set<string>>(agents.map(a => [a.id, new Set(a.team ? [a.team] : [])]));
  for (const [queue, ids] of Object.entries(members)) for (const id of ids) byId.get(id)?.add(queue);
  return new Map(agents.map(a => [a.uid, [...byId.get(a.id)!].sort((x, y) => x.localeCompare(y))]));
}

/**
 * The viewer's agents grouped by Team Lead, with the queues they sit in, call-outs by stage,
 * open incidents and the most frequent rule. With `queue`, only that queue's agents count.
 * Floor call-outs belong to no Team Lead and are left out. Sorted by Team Lead, with agents
 * who have none last.
 */
export function leadRows(
  agents: { uid: string }[],
  leadOf: (uid: string) => AgentLeads | undefined,
  queuesOf: (uid: string) => string[],
  ledger: Pick<Instance, "agentId" | "isFloor" | "stage" | "rule">[],
  incidents: Pick<Incident, "agentId" | "status">[],
  queue = "",
): LeadRow[] {
  const rows = new Map<string, LeadRow & { rules: Map<string, number>; qs: Set<string> }>();
  const tlOf = new Map<string, string>();
  for (const a of agents) {
    const queues = queuesOf(a.uid);
    if (queue && !queues.includes(queue)) continue;
    const { tl, mgr } = leadNames(leadOf(a.uid));
    tlOf.set(a.uid, tl);
    const r = rows.get(tl) ?? { tl, mgr, agents: 0, queues: [], n: 0, l: 0, o: 0, ir: 0, top: "—", rules: new Map(), qs: new Set() };
    r.agents++;
    for (const q of queues) r.qs.add(q);
    rows.set(tl, r);
  }
  for (const c of ledger) {
    const r = !c.isFloor && c.agentId ? rows.get(tlOf.get(c.agentId) ?? "") : undefined;
    if (!r) continue;
    if (c.stage === "nudge") r.n++; else if (c.stage === "lead") r.l++; else r.o++;
    r.rules.set(c.rule, (r.rules.get(c.rule) ?? 0) + 1);
  }
  for (const i of incidents) {
    const r = rows.get(tlOf.get(i.agentId) ?? "");
    if (r && i.status !== "Closed") r.ir++;
  }
  return [...rows.values()]
    .map(({ rules, qs, ...r }) => {
      let best: [string, number] | null = null;
      for (const e of rules) if (!best || e[1] > best[1]) best = e;
      return { ...r, queues: [...qs].sort((x, y) => x.localeCompare(y)), top: best ? `${best[0]} ×${best[1]}` : "—" };
    })
    .sort(byLead);
}
