import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Roster, Team } from "@/lib/types";

// The last roster Gencloud delivered, kept on this machine. The live floor starts from it while
// the real roster loads (minutes, for hundreds of queues), and the simulator puts its real team
// and agent names on its floor when Gencloud is not reachable (expired token, offline).
// Names and queue membership only, no states. The folder is gitignored: these are real people.

const FILE = path.join(process.cwd(), ".rtm", "roster.json");

export interface RosterNames { org: Team[]; agents: { name: string; team: string }[]; members?: Record<string, string[]> }

export function saveRoster(roster: Roster): void {
  if (!roster.agents.length) return;
  const names: RosterNames = { org: roster.org, agents: roster.agents.map(({ name, team }) => ({ name, team })), members: roster.members };
  try {
    mkdirSync(path.dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(names));
  } catch { /* a convenience: without it the simulator falls back to its sample names */ }
}

export function loadRoster(): RosterNames | null {
  try {
    const x = JSON.parse(readFileSync(FILE, "utf8")) as Partial<RosterNames> | null;
    if (!x || !Array.isArray(x.org) || !Array.isArray(x.agents)) return null;
    const members = x.members && typeof x.members === "object" ? x.members : undefined;
    return { org: x.org, agents: x.agents, ...(members && { members }) };
  } catch { return null; }
}
