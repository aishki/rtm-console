import type { Agent, Incident, Instance, PeopleDirectory, Person, Perms, Role, Team, Unsupervised, View } from "@/lib/types";

export const PERMS: Record<Role, Perms> = {
  admin: { tabs: ["console", "dash", "rules", "ledger"], rulesEdit: true, invAct: true, export: true, ackAll: true, ir: true, replay: true, feed: true, mapping: true, desc: () => "Full access: rules admin, ledger controls, all teams" },
  senior: { tabs: ["dash"], rulesEdit: false, invAct: false, export: false, ackAll: false, ir: false, replay: false, feed: false, mapping: false, desc: () => "Dashboards with team breakdown, read-only, all teams" },
  mgr: { tabs: ["console", "dash", "rules", "ledger"], rulesEdit: true, invAct: true, export: true, ackAll: false, ir: true, replay: true, feed: false, mapping: false, desc: w => `Span of ${w}, incident tiles + rules admin` },
  tl: { tabs: ["console", "dash", "ledger"], rulesEdit: false, invAct: false, export: false, ackAll: false, ir: false, replay: false, feed: false, mapping: false, desc: w => `Direct reports of ${w} only` },
  agent: { tabs: ["myview"], rulesEdit: false, invAct: false, export: false, ackAll: false, ir: false, replay: false, feed: false, mapping: false, desc: w => `What ${w} sees: own targets and pop-ups` },
};

/** Reporting lines by uid: who each agent's and leader's supervisor is. */
export type People = Record<string, { name: string; supervisor: string | null }>;

/** The floor a viewer is scoped against. `members`: queue name to agent ids, when the feed sends membership. */
export interface Floor { org: Team[]; agents: Agent[]; people: People; members?: Record<string, number[]> }

// A reporting line longer than this is taken to be a loop in the data.
const MAX_LEVELS = 15;

/** The uids above `uid`, nearest first: their Team Lead, then their Manager, and on up. Stops at a loop. */
export function chainAbove(people: People, uid: string): string[] {
  const out: string[] = [], seen = new Set([uid]);
  let cur = people[uid]?.supervisor ?? null;
  while (cur && !seen.has(cur) && out.length < MAX_LEVELS) { out.push(cur); seen.add(cur); cur = people[cur]?.supervisor ?? null; }
  return out;
}

const personOf = (people: People, uid: string): Person => ({ key: uid, name: people[uid]?.name ?? uid });

/** An agent's Team Lead (their supervisor) and Manager (the Team Lead's supervisor); null where there is none. */
export function leadersOf(people: People, uid: string): { tl: Person | null; mgr: Person | null } {
  const [tl, mgr] = chainAbove(people, uid);
  return { tl: tl ? personOf(people, tl) : null, mgr: mgr ? personOf(people, mgr) : null };
}

/** A Team Lead's span is their direct reports; a Manager's is everyone below them. Admin and Senior Leader see all. */
function inSpan(people: People, v: View, uid: string): boolean {
  if (v.role === "tl") return people[uid]?.supervisor === v.who;
  if (v.role === "mgr") return !!v.who && chainAbove(people, uid).includes(v.who);
  if (v.role === "agent") return uid === v.who;
  return true;
}

export function scopeAgents(f: Floor, v: View): Agent[] {
  if (v.role === "admin" || v.role === "senior") return f.agents;
  return f.agents.filter(a => inSpan(f.people, v, a.uid));
}
/** The queues the viewer's agents are on (all of them for Admin and Senior Leader). */
export function scopeTeams(f: Floor, v: View): Team[] {
  if (v.role === "admin" || v.role === "senior") return f.org;
  const mine = scopeAgents(f, v);
  const ids = new Set(mine.map(a => a.id)), teams = new Set(mine.map(a => a.team));
  return f.org.filter(t => teams.has(t.team) || (f.members?.[t.team] ?? []).some(id => ids.has(id)));
}
/** Queue and floor call-outs are visible to every leader role; agents only see their own. */
export function inScope(f: Floor, v: View, r: Pick<Instance, "agentId" | "isFloor">): boolean {
  if (v.role === "agent") return r.agentId === v.who;
  if (r.isFloor) return true;
  return r.agentId !== null && inSpan(f.people, v, r.agentId);
}
export const scopeLedger = (f: Floor, v: View, ledger: Instance[]): Instance[] => ledger.filter(r => inScope(f, v, r));
export const scopeIncidents = (f: Floor, v: View, incidents: Incident[]): Incident[] => incidents.filter(i => inSpan(f.people, v, i.agentId));

const agentPerson = (a: Agent): Person => ({ key: a.uid, name: a.name });
const byName = (a: Person, b: Person) => a.name.localeCompare(b.name);

/** Team Leads: the supervisors of agents on the floor. Managers: everyone above a Team Lead. */
export function peopleFor(f: Floor, role: Role): Person[] {
  if (role === "agent") return f.agents.map(agentPerson);
  if (role !== "tl" && role !== "mgr") return [];
  const keys = new Set<string>();
  for (const a of f.agents) {
    const chain = chainAbove(f.people, a.uid);
    for (const k of role === "tl" ? chain.slice(0, 1) : chain.slice(1)) keys.add(k);
  }
  return [...keys].map(k => personOf(f.people, k)).sort(byName);
}

/** Agents on the floor with no supervisor, for admins to have fixed in Genesys. */
export const unsupervised = (f: Floor): Unsupervised[] =>
  f.agents.filter(a => !f.people[a.uid]?.supervisor).map(a => ({ uid: a.uid, name: a.name, team: a.team })).sort((a, b) => a.name.localeCompare(b.name));
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
/** The name to show for the viewer, from their uid. */
export function viewerName(v: View, f: Pick<Floor, "agents" | "people">): string | null {
  if (!v.who) return null;
  return f.agents.find(a => a.uid === v.who)?.name ?? f.people[v.who]?.name ?? null;
}

export const teamOf = (org: Team[], team: string): Team => org.find(x => x.team === team) ?? { team, tl: "—", mgr: "—", lob: team };

/** Leaders acknowledge in-span call-outs from the Console; agents acknowledge their own nudges. */
export function canAck(f: Floor, v: View, r: Instance): boolean {
  if (v.role === "agent") return r.agentId === v.who;
  return PERMS[v.role].tabs.includes("console") && inScope(f, v, r);
}
/** Only the associate the call-out belongs to can attach a reason to it. */
export const canComment = (v: View, r: Instance): boolean => v.role === "agent" && !r.isFloor && r.agentId === v.who;
