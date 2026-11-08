import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_ORG, type OrgId } from "@/lib/orgs";
import type { OrgPerson, Roster, Team } from "@/lib/types";

// The last roster each org's Gencloud feed delivered, kept on this machine. The live floor starts
// from it while the real roster loads (minutes, for hundreds of queues), and the simulator puts
// its real team and agent names on its floor when Gencloud is not reachable (expired token, offline).
// Genesys user IDs, names, queue membership and supervisors only, no states. The folder is gitignored: these are real people.

/** Commercial keeps the file it had before there were several orgs. */
// turbopackIgnore: read at run time only. The build must not trace .rtm/, whose files can be unreadable to the user who builds.
const fileFor = (org: OrgId) => path.join(/* turbopackIgnore: true */ process.cwd(), ".rtm", org === "commercial" ? "roster.json" : `roster.${org}.json`);

/** `uid` is missing from files saved before agents were keyed by Genesys ID, and `members` then holds names. */
export interface RosterNames { org: Team[]; agents: { uid?: string; name: string; team: string }[]; members?: Record<string, string[]>; people?: OrgPerson[] }

function write(org: OrgId, names: RosterNames): void {
  const file = fileFor(org);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(names));
  } catch { /* a convenience: without it the floor starts empty and the simulator uses sample names */ }
}

/** A roster without reporting lines keeps the ones saved before (they arrive after it). */
export function saveRoster(roster: Roster, org: OrgId = DEFAULT_ORG): void {
  if (!roster.agents.length) return;
  const people = roster.people ?? loadRoster(org)?.people;
  write(org, { org: roster.org, agents: roster.agents.map(({ uid, name, team }) => ({ uid, name, team })), members: roster.members, ...(people && { people }) });
}

/** The reporting lines found after the roster, saved with it. */
export function savePeople(people: OrgPerson[], org: OrgId = DEFAULT_ORG): void {
  const saved = loadRoster(org);
  if (saved) write(org, { ...saved, people });
}

export function loadRoster(org: OrgId = DEFAULT_ORG): RosterNames | null {
  try {
    const x = JSON.parse(readFileSync(fileFor(org), "utf8")) as Partial<RosterNames> | null;
    if (!x || !Array.isArray(x.org) || !Array.isArray(x.agents)) return null;
    const members = x.members && typeof x.members === "object" ? x.members : undefined;
    const people = Array.isArray(x.people) ? x.people : undefined;
    return { org: x.org, agents: x.agents, ...(members && { members }), ...(people && { people }) };
  } catch { return null; }
}
