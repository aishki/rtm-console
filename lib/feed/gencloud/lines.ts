import type { OrgPerson } from "@/lib/types";
import { domainIdOf } from "@/lib/engine/format";
import type { ManagerLookup } from "@/lib/directory/cgsManagers";
import type { UserLine } from "./client";

/** Where reporting lines come from. `managerOf` is the CGS directory, left out when it is not set up. */
export interface LineSources {
  /** Active users' names and Genesys supervisors. */
  users(ids: string[]): Promise<UserLine[]>;
  /** The active Genesys user with this Domain ID. */
  byDomainId(domainId: string): Promise<UserLine | null>;
  managerOf?: ManagerLookup;
}

/** How the floor's agents got their supervisor. */
export interface LineCounts { agents: number; genesys: number; directory: number; none: number }

// Supervisors are looked up this many levels above the agents: enough for every Manager's span.
const MAX_LEVELS = 8;
// While the directory is being asked (about one agent a second), progress is sent this often.
const SEND_EVERY = 25;

/**
 * Each agent's reporting line: their Genesys supervisor (`manager.id`) and the chain above it.
 * Where Genesys has none, for an agent or their Team Lead, the CGS directory's manager is used
 * (Genesys first, the directory fills the gaps), matched to a Genesys user by Domain ID.
 * `send` gets the lines as they stand: once from Genesys, then as the directory fills them.
 * A supervisor whose account is inactive or missing counts as none.
 */
export async function resolveLines(
  agents: { uid: string; name: string }[],
  src: LineSources,
  send: (people: OrgPerson[]) => void,
  stopped: () => boolean = () => false,
): Promise<LineCounts | null> {
  const known = new Map<string, { name: string; supervisor: string | null }>();
  const fromDirectory = new Set<string>();
  for (const a of agents) known.set(a.uid, { name: a.name, supervisor: null });
  for (const u of await src.users(agents.map(a => a.uid))) known.set(u.id, { name: known.get(u.id)?.name ?? u.name, supervisor: u.managerId });

  /** Looks up supervisors not known yet, level by level. Ones Genesys does not return stay unknown. */
  const looked = new Set<string>();
  const climb = async () => {
    for (let i = 0; i < MAX_LEVELS && !stopped(); i++) {
      const missing = [...new Set([...known.values()].flatMap(p => (p.supervisor && !known.has(p.supervisor) && !looked.has(p.supervisor) ? [p.supervisor] : [])))];
      if (!missing.length) return;
      for (const id of missing) looked.add(id);
      for (const u of await src.users(missing)) known.set(u.id, { name: u.name, supervisor: u.managerId });
    }
  };
  const supervisorOf = (uid: string): string | null => {
    const s = known.get(uid)?.supervisor ?? null;
    return s && s !== uid && known.has(s) ? s : null;
  };
  const lines = (): OrgPerson[] => [...known].map(([uid, p]) => ({ uid, name: p.name, supervisor: supervisorOf(uid) }));
  const counts = (): LineCounts => {
    const c = { agents: agents.length, genesys: 0, directory: 0, none: 0 };
    for (const a of agents) {
      if (!supervisorOf(a.uid)) c.none++;
      else if (fromDirectory.has(a.uid)) c.directory++;
      else c.genesys++;
    }
    return c;
  };

  await climb();
  if (stopped()) return null;
  send(lines());
  if (!src.managerOf) return counts();

  // The directory fills in agents with no supervisor, then the Team Leads it or Genesys gave them
  // who have none: enough for every agent's Team Lead and Manager.
  const byDomainId = new Map<string, string>();
  for (const [uid, p] of known) { const d = domainIdOf(p.name); if (d && !byDomainId.has(d)) byDomainId.set(d, uid); }
  const queue: [string, number][] = [];
  const queued = new Set<string>();
  const enqueue = (uid: string, level: number) => { if (!queued.has(uid)) { queued.add(uid); queue.push([uid, level]); } };
  for (const a of agents) if (!supervisorOf(a.uid)) enqueue(a.uid, 0);
  for (const a of agents) { const tl = supervisorOf(a.uid); if (tl && !supervisorOf(tl)) enqueue(tl, 1); }

  let filled = 0;
  for (let i = 0; i < queue.length; i++) {
    if (stopped()) return null;
    const [uid, level] = queue[i];
    const domainId = domainIdOf(known.get(uid)?.name ?? "");
    if (!domainId) continue;
    const managerId = (await src.managerOf(domainId))?.trim().toUpperCase();
    if (!managerId || managerId === domainId) continue;
    let manager = byDomainId.get(managerId);
    if (!manager) {
      const u = await src.byDomainId(managerId);
      if (!u) continue;
      known.set(u.id, { name: u.name, supervisor: u.managerId });
      byDomainId.set(managerId, u.id);
      manager = u.id;
      await climb();
    }
    if (manager === uid) continue;
    known.get(uid)!.supervisor = manager;
    fromDirectory.add(uid);
    if (level === 0 && !supervisorOf(manager)) enqueue(manager, 1);
    if (++filled % SEND_EVERY === 0) send(lines());
  }
  if (stopped()) return null;
  if (filled % SEND_EVERY !== 0) send(lines());
  return counts();
}
