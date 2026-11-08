import type { OrgPerson } from "@/lib/types";

/**
 * Reporting lines for a source that names one Team Lead and one Manager per team (the
 * simulator, an imported workbook): each agent reports to their team's Team Lead, and the
 * Team Lead to the Manager. Leaders get made-up uids from their names, under `prefix`
 * ("sim:", "csv:"), so they can never be taken for Genesys IDs.
 */
export function teamLines(
  teams: { team: string; tl: string; mgr: string }[],
  agents: { uid: string; name: string; team: string }[],
  prefix: string,
): OrgPerson[] {
  const uid = (name: string) => `${prefix}lead:${name}`;
  const out = new Map<string, OrgPerson>();
  // A leader named on several teams is one person; the first team that names them sets their Manager.
  for (const t of teams) {
    if (t.mgr && !out.has(uid(t.mgr))) out.set(uid(t.mgr), { uid: uid(t.mgr), name: t.mgr, supervisor: null });
    if (t.tl && t.tl !== t.mgr) {
      const known = out.get(uid(t.tl));
      if (!known || known.supervisor === null) out.set(uid(t.tl), { uid: uid(t.tl), name: t.tl, supervisor: t.mgr ? uid(t.mgr) : null });
    }
  }
  const tlOf = new Map(teams.map(t => [t.team, t.tl ? uid(t.tl) : null]));
  for (const a of agents) out.set(a.uid, { uid: a.uid, name: a.name, supervisor: tlOf.get(a.team) ?? null });
  return [...out.values()];
}
