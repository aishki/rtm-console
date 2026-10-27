import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_ORG, type OrgId } from "@/lib/orgs";
import type { Roster, Team } from "@/lib/types";

// The last roster each org's Gencloud feed delivered, kept on this machine. The live floor starts
// from it while the real roster loads (minutes, for hundreds of queues), and the simulator puts
// its real team and agent names on its floor when Gencloud is not reachable (expired token, offline).
// Names and queue membership only, no states. The folder is gitignored: these are real people.

/** Commercial keeps the file it had before there were several orgs. */
const fileFor = (org: OrgId) => path.join(process.cwd(), ".rtm", org === "commercial" ? "roster.json" : `roster.${org}.json`);

export interface RosterNames { org: Team[]; agents: { name: string; team: string }[]; members?: Record<string, string[]> }

export function saveRoster(roster: Roster, org: OrgId = DEFAULT_ORG): void {
  if (!roster.agents.length) return;
  const names: RosterNames = { org: roster.org, agents: roster.agents.map(({ name, team }) => ({ name, team })), members: roster.members };
  const file = fileFor(org);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(names));
  } catch { /* a convenience: without it the floor starts empty and the simulator uses sample names */ }
}

export function loadRoster(org: OrgId = DEFAULT_ORG): RosterNames | null {
  try {
    const x = JSON.parse(readFileSync(fileFor(org), "utf8")) as Partial<RosterNames> | null;
    if (!x || !Array.isArray(x.org) || !Array.isArray(x.agents)) return null;
    const members = x.members && typeof x.members === "object" ? x.members : undefined;
    return { org: x.org, agents: x.agents, ...(members && { members }) };
  } catch { return null; }
}
