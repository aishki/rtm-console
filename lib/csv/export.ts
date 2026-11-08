import type { Incident, Instance, SeveralLobs, Unsupervised } from "@/lib/types";
import { clock, splitAgent } from "@/lib/engine/format";
import { ownerLabel } from "@/lib/engine/rules";

const q = (s: unknown) => `"${String(s).replace(/"/g, '""')}"`;

/** Instance ledger as CSV, oldest first. Pass rows already scoped to the viewer. */
export function ledgerCsv(rows: Instance[]): string {
  const h = "instance,time,agent,team,rule,value,stage,incident,status,response_s,agent_comment\n";
  return h + [...rows].reverse().map(r => [r.n, clock(r.t), q(r.agent), q(r.team), q(r.rule), q(r.val), r.stage, r.inc || "", r.status, r.ackT !== null ? r.ackT - r.t : "", q(r.cmt || "")].join(",")).join("\n");
}

/** Investigation register as CSV, oldest first. Pass incidents already scoped to the viewer. */
export function incidentsCsv(rows: Incident[]): string {
  const h = "incident,opened,agent,team,rule,instances,status,owner,disposition,closed,comments,resolution\n";
  return h + [...rows].reverse().map(i => [
    i.inc, clock(i.t), q(i.agent), q(i.team), q(i.rule), i.instances, i.status, q(i.owner ? ownerLabel(i.owner) : ""), q(i.disposition || ""),
    i.closedT !== null ? clock(i.closedT) : "", q(i.comments || ""), q(i.resolution || ""),
  ].join(",")).join("\n");
}

/** Agents with no supervisor, by name, for an admin to have their supervisor set in Genesys. */
export function unsupervisedCsv(rows: Unsupervised[]): string {
  const h = "agent,domain_id,queue\n";
  return h + rows.map(a => { const { who, id } = splitAgent(a.name); return [q(who), q(id), q(a.team)].join(","); }).join("\n");
}

/** Agents whose queues are in more than one LOB, for an admin to check the mapping. `lob` is the one their rules follow. */
export function severalLobsCsv(rows: SeveralLobs[]): string {
  const h = "agent,domain_id,queue,lob,other_lobs\n";
  return h + rows.map(a => { const { who, id } = splitAgent(a.name); return [q(who), q(id), q(a.team), q(a.lobs[0]), q(a.lobs.slice(1).join("; "))].join(","); }).join("\n");
}
