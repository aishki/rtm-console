import { DEFAULT_ORG, type OrgId } from "@/lib/orgs";
import { readRosterFile } from "@/lib/store/files";
import type { RosterNames } from "@/lib/store/store";
import type { OrgPerson, Roster } from "@/lib/types";
import { bootRoster, store } from "./store";

// The last roster each org's Gencloud feed delivered. The live floor starts from it while the real
// roster loads (minutes, for hundreds of queues), and the simulator puts its real team and agent
// names on its floor when Gencloud is not reachable (expired token, offline).
// Genesys user IDs, names, queue membership and supervisors only, no states: these are real people.
// With PostgreSQL it lives in person, queue and queue_member; without, in .rtm/ (gitignored).

export type { RosterNames };

const g = globalThis as typeof globalThis & { __rtmRosters?: Partial<Record<OrgId, RosterNames | null>> };
const cache = (g.__rtmRosters ??= {});

/** A roster without reporting lines keeps the ones saved before (they arrive after it). */
export function saveRoster(roster: Roster, org: OrgId = DEFAULT_ORG): void {
  if (!roster.agents.length) return;
  const before = loadRoster(org);
  const people = roster.people ?? before?.people;
  const queues = roster.queues ?? before?.queues;
  const names: RosterNames = {
    org: roster.org, agents: roster.agents.map(({ uid, name, team, lastLogin }) => ({ uid, name, team, ...(lastLogin && { lastLogin }) })), members: roster.members,
    ...(people && { people }), ...(queues && { queues }),
  };
  cache[org] = names;
  store().rosterChanged(org, names);
}

/** The reporting lines found after the roster, saved with it. */
export function savePeople(people: OrgPerson[], org: OrgId = DEFAULT_ORG): void {
  const saved = loadRoster(org);
  if (!saved) return;
  const names = { ...saved, people };
  cache[org] = names;
  store().rosterChanged(org, names);
}

/** The org's last roster: as the store loaded it at start-up, then as the feed last delivered it. */
export function loadRoster(org: OrgId = DEFAULT_ORG): RosterNames | null {
  if (!(org in cache)) cache[org] = bootRoster(org) ?? readRosterFile(org);
  return cache[org] ?? null;
}
