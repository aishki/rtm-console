import type { Incident, Instance, Stage } from "@/lib/types";

// The ledger's and the register's search and filters, shared by the screens and their CSV exports
// so a download holds exactly the rows on screen.

/** True when an agent's Genesys name ("Last, First - AH12345") contains the search, so it matches a name or a Domain ID. */
export const nameOrIdMatches = (name: string, query: string): boolean => {
  const q = query.trim().toLowerCase();
  return !q || name.toLowerCase().includes(q);
};

export interface ListFilter { q: string; queues: string[]; stage?: Stage | "" }

const STAGES: readonly string[] = ["nudge", "lead", "ops"];

export const ledgerMatches = (f: ListFilter) => (r: Instance): boolean =>
  (!f.stage || r.stage === f.stage) && (!f.queues.length || f.queues.includes(r.team)) && nameOrIdMatches(r.agent, f.q);

export const incidentMatches = (f: ListFilter) => (i: Incident): boolean =>
  (!f.queues.length || f.queues.includes(i.team)) && nameOrIdMatches(i.agent, f.q);

/** `path` with the filter as query parameters, leaving out what is not set. */
export function withFilter(path: string, f: ListFilter): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  for (const q of f.queues) p.append("queue", q);
  if (f.stage) p.set("stage", f.stage);
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}

/** The filter a request's query parameters carry; an unknown stage is ignored. */
export function readFilter(params: URLSearchParams): ListFilter {
  const stage = params.get("stage") ?? "";
  return { q: params.get("q") ?? "", queues: params.getAll("queue"), stage: STAGES.includes(stage) ? (stage as Stage) : "" };
}
