import type { Agent, Incident, Instance, PeopleDirectory, Perms, Role, Team, View } from "@/lib/types";

export const PERMS: Record<Role, Perms> = {
  admin: { tabs: ["console", "dash", "rules", "ledger"], rulesEdit: true, invAct: true, export: true, ackAll: true, ir: true, replay: true, feed: true, desc: () => "Full access: rules admin, ledger controls, all teams" },
  senior: { tabs: ["dash"], rulesEdit: false, invAct: false, export: false, ackAll: false, ir: false, replay: false, feed: false, desc: () => "Dashboards with team breakdown, read-only, all teams" },
  mgr: { tabs: ["console", "dash", "rules", "ledger"], rulesEdit: true, invAct: true, export: true, ackAll: false, ir: true, replay: true, feed: false, desc: w => `Span of ${w}, incident tiles + rules admin` },
  tl: { tabs: ["console", "dash", "ledger"], rulesEdit: false, invAct: false, export: false, ackAll: false, ir: false, replay: false, feed: false, desc: w => `Direct reports of ${w} only` },
  agent: { tabs: ["myview"], rulesEdit: false, invAct: false, export: false, ackAll: false, ir: false, replay: false, feed: false, desc: w => `What ${w} sees: own targets and pop-ups` },
};

/** The floor a viewer is scoped against. */
export interface Floor { org: Team[]; agents: Agent[] }

export function scopeTeams(f: Floor, v: View): Team[] {
  if (v.role === "tl") return f.org.filter(t => t.tl === v.who);
  if (v.role === "mgr") return f.org.filter(t => t.mgr === v.who);
  if (v.role === "agent") { const a = f.agents.find(x => x.name === v.who); return a ? f.org.filter(t => t.team === a.team) : []; }
  return f.org;
}
export function scopeAgents(f: Floor, v: View): Agent[] {
  if (v.role === "agent") return f.agents.filter(a => a.name === v.who);
  const n = new Set(scopeTeams(f, v).map(t => t.team));
  return f.agents.filter(a => n.has(a.team));
}
/** Queue and floor call-outs are visible to every leader role; agents only see their own. */
export function inScope(f: Floor, v: View, r: Pick<Instance, "agent" | "team" | "isFloor">): boolean {
  if (v.role === "agent") return r.agent === v.who;
  if (r.isFloor) return true;
  return scopeTeams(f, v).some(t => t.team === r.team);
}
export const scopeLedger = (f: Floor, v: View, ledger: Instance[]): Instance[] => ledger.filter(r => inScope(f, v, r));
export function scopeIncidents(f: Floor, v: View, incidents: Incident[]): Incident[] {
  if (v.role === "agent") return incidents.filter(i => i.agent === v.who);
  const n = new Set(scopeTeams(f, v).map(t => t.team));
  return incidents.filter(i => n.has(i.team));
}

export function peopleFor(f: Floor, role: Role): string[] {
  if (role === "tl") return [...new Set(f.org.map(t => t.tl))];
  if (role === "mgr") return [...new Set(f.org.map(t => t.mgr))];
  if (role === "agent") return f.agents.map(a => a.name);
  return [];
}
export function peopleDirectory(f: Floor): PeopleDirectory {
  return {
    tls: peopleFor(f, "tl"), mgrs: peopleFor(f, "mgr"),
    agentsByTeam: f.org.map(t => ({ team: t.team, agents: f.agents.filter(a => a.team === t.team).map(a => a.name) })).filter(g => g.agents.length),
  };
}
/** Snap a requested view onto a person that exists for the role (first one when unknown). */
export function resolveView(f: Floor, v: View): View {
  const people = peopleFor(f, v.role);
  if (!people.length) return { role: v.role, who: null };
  return { role: v.role, who: v.who && people.includes(v.who) ? v.who : people[0] };
}

export const teamOf = (org: Team[], team: string): Team => org.find(x => x.team === team) ?? { team, tl: "—", mgr: "—", lob: team };

/** Leaders acknowledge in-span call-outs from the Console; agents acknowledge their own nudges. */
export function canAck(f: Floor, v: View, r: Instance): boolean {
  if (v.role === "agent") return r.agent === v.who;
  return PERMS[v.role].tabs.includes("console") && inScope(f, v, r);
}
/** Only the associate the call-out belongs to can attach a reason to it. */
export const canComment = (v: View, r: Instance): boolean => v.role === "agent" && !r.isFloor && r.agent === v.who;
