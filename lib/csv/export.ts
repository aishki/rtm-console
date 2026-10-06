import type { Incident, Instance } from "@/lib/types";
import { clock } from "@/lib/engine/format";

const q = (s: unknown) => `"${String(s).replace(/"/g, '""')}"`;

/** Instance ledger as CSV, oldest first. Pass rows already scoped to the viewer. */
export function ledgerCsv(rows: Instance[]): string {
  const h = "instance,time,agent,team,rule,value,stage,incident,status,response_s,agent_comment\n";
  return h + [...rows].reverse().map(r => [r.n, clock(r.t), q(r.agent), q(r.team), q(r.rule), q(r.val), r.stage, r.inc || "", r.status, r.ackT !== null ? r.ackT - r.t : "", q(r.cmt || "")].join(",")).join("\n");
}

/** Investigation register as CSV, oldest first. Pass incidents already scoped to the viewer. */
export function incidentsCsv(rows: Incident[]): string {
  const h = "incident,opened,agent,team,rule,instances,status,disposition,closed\n";
  return h + [...rows].reverse().map(i => [i.inc, clock(i.t), q(i.agent), q(i.team), q(i.rule), i.instances, i.status, q(i.disposition || ""), i.closedT !== null ? clock(i.closedT) : ""].join(",")).join("\n");
}
