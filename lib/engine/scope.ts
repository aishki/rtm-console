import type { Agent, Incident, Instance, PeopleDirectory, Person, Perms, Role, Team, View } from "@/lib/types";

export const PERMS: Record<Role, Perms> = {
  admin: { tabs: ["console", "dash", "rules", "ledger"], rulesEdit: true, invAct: true, export: true, ackAll: true, ir: true, replay: true, feed: true, mapping: true, desc: () => "Full access: rules admin, ledger controls, all teams" },
  senior: { tabs: ["dash"], rulesEdit: false, invAct: false, export: false, ackAll: false, ir: false, replay: false, feed: false, mapping: false, desc: () => "Dashboards with team breakdown, read-only, all teams" },
  mgr: { tabs: ["console", "dash", "rules", "ledger"], rulesEdit: true, invAct: true, export: true, ackAll: false, ir: true, replay: true, feed: false, mapping: false, desc: w => `Span of ${w}, incident tiles + rules admin` },
  tl: { tabs: ["console", "dash", "ledger"], rulesEdit: false, invAct: false, export: false, ackAll: false, ir: false, replay: false, feed: false, mapping: false, desc: w => `Direct reports of ${w} only` },
  agent: { tabs: ["myview"], rulesEdit: false, invAct: false, export: false, ackAll: false, ir: false, replay: false, feed: false, mapping: false, desc: w => `What ${w} sees: own targets and pop-ups` },
};

/** The floor a viewer is scoped against. */
export interface Floor { org: Team[]; agents: Agent[] }

export function scopeTeams(f: Floor, v: View): Team[] {
  if (v.role === "tl") return f.org.filter(t => t.tl === v.who);
  if (v.role === "mgr") return f.org.filter(t => t.mgr === v.who);
  if (v.role === "agent") { const a = f.agents.find(x => x.uid === v.who); return a ? f.org.filter(t => t.team === a.team) : []; }
  return f.org;
}
export function scopeAgents(f: Floor, v: View): Agent[] {
  if (v.role === "agent") return f.agents.filter(a => a.uid === v.who);
  const n = new Set(scopeTeams(f, v).map(t => t.team));
  return f.agents.filter(a => n.has(a.team));
}
/** Queue and floor call-outs are visible to every leader role; agents only see their own. */
export function inScope(f: Floor, v: View, r: Pick<Instance, "agentId" | "team" | "isFloor">): boolean {
  if (v.role === "agent") return r.agentId === v.who;
  if (r.isFloor) return true;
  return scopeTeams(f, v).some(t => t.team === r.team);
}
export const scopeLedger = (f: Floor, v: View, ledger: Instance[]): Instance[] => ledger.filter(r => inScope(f, v, r));
export function scopeIncidents(f: Floor, v: View, incidents: Incident[]): Incident[] {
  if (v.role === "agent") return incidents.filter(i => i.agentId === v.who);
  const n = new Set(scopeTeams(f, v).map(t => t.team));
  return incidents.filter(i => n.has(i.team));
}

/** Leaders are known by name until they come from Genesys, so their key is their name. */
const byName = (name: string): Person => ({ key: name, name });
const agentPerson = (a: Agent): Person => ({ key: a.uid, name: a.name });

export function peopleFor(f: Floor, role: Role): Person[] {
  if (role === "tl") return [...new Set(f.org.map(t => t.tl))].map(byName);
  if (role === "mgr") return [...new Set(f.org.map(t => t.mgr))].map(byName);
  if (role === "agent") return f.agents.map(agentPerson);
  return [];
}
export function peopleDirectory(f: Floor): PeopleDirectory {
  return {
    tls: peopleFor(f, "tl"), mgrs: peopleFor(f, "mgr"),
    agentsByTeam: f.org.map(t => ({ team: t.team, agents: f.agents.filter(a => a.team === t.team).map(agentPerson) })).filter(g => g.agents.length),
  };
}
/** Snap a requested view onto a person that exists for the role (first one when unknown). */
export function resolveView(f: Floor, v: View): View {
  const people = peopleFor(f, v.role);
  if (!people.length) return { role: v.role, who: null };
  return { role: v.role, who: v.who && people.some(p => p.key === v.who) ? v.who : people[0].key };
}
/** The name to show for the viewer: an agent's name from their uid, a leader's name as it is. */
export function viewerName(v: View, agents: Agent[]): string | null {
  if (v.role === "agent") return agents.find(a => a.uid === v.who)?.name ?? null;
  return v.who;
}

export const teamOf = (org: Team[], team: string): Team => org.find(x => x.team === team) ?? { team, tl: "—", mgr: "—", lob: team };

/** Leaders acknowledge in-span call-outs from the Console; agents acknowledge their own nudges. */
export function canAck(f: Floor, v: View, r: Instance): boolean {
  if (v.role === "agent") return r.agentId === v.who;
  return PERMS[v.role].tabs.includes("console") && inScope(f, v, r);
}
/** Only the associate the call-out belongs to can attach a reason to it. */
export const canComment = (v: View, r: Instance): boolean => v.role === "agent" && !r.isFloor && r.agentId === v.who;
