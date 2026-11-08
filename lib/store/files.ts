import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { QueueMapRow } from "@/lib/import/queueMap";
import type { OrgId } from "@/lib/orgs";
import type { RosterNames } from "./store";

// What the memory store keeps in .rtm/ (gitignored) so it outlives a restart without a database:
// the queue map and each org's last roster. These are real people and internal queue names.

// turbopackIgnore: read at run time only. The build must not trace .rtm/, whose files can be unreadable to the user who builds.
export const RTM_DIR = (): string => path.join(/* turbopackIgnore: true */ process.cwd(), ".rtm");

// ---- the queue map ----

const mapFile = (dir: string) => path.join(dir, "queue-map.json");

const filled = (v: unknown) => typeof v === "string" && v !== "";
const optional = (v: unknown) => v === undefined || typeof v === "string";
/** A row the tree can place: tower, sub-tower, LOB and queue filled in; region and org text if present. */
function isRow(x: unknown): x is QueueMapRow {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return filled(r.tower) && filled(r.subTower) && filled(r.lob) && filled(r.queue) && optional(r.region) && optional(r.org);
}

export function readQueueMapFile(dir = RTM_DIR()): QueueMapRow[] {
  try {
    const x: unknown = JSON.parse(readFileSync(mapFile(dir), "utf8"));
    return Array.isArray(x) ? x.filter(isRow) : [];
  } catch { return []; }
}

export function writeQueueMapFile(rows: QueueMapRow[], dir = RTM_DIR()): void {
  mkdirSync(dir, { recursive: true });
  // Written beside the mapping and renamed over it, so a crash mid-write never leaves half a file.
  const temp = `${mapFile(dir)}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(rows));
  renameSync(temp, mapFile(dir));
}

// ---- each org's last roster ----

/** Commercial keeps the file it had before there were several orgs. */
const rosterFile = (org: OrgId, dir: string) => path.join(dir, org === "commercial" ? "roster.json" : `roster.${org}.json`);

export function writeRosterFile(org: OrgId, names: RosterNames, dir = RTM_DIR()): void {
  const file = rosterFile(org, dir);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(names));
  } catch { /* a convenience: without it the floor starts empty and the simulator uses sample names */ }
}

export function readRosterFile(org: OrgId, dir = RTM_DIR()): RosterNames | null {
  try {
    const x = JSON.parse(readFileSync(rosterFile(org, dir), "utf8")) as Partial<RosterNames> | null;
    if (!x || !Array.isArray(x.org) || !Array.isArray(x.agents)) return null;
    const members = x.members && typeof x.members === "object" ? x.members : undefined;
    const people = Array.isArray(x.people) ? x.people : undefined;
    const queues = Array.isArray(x.queues) ? x.queues : undefined;
    return { org: x.org, agents: x.agents, ...(members && { members }), ...(people && { people }), ...(queues && { queues }) };
  } catch { return null; }
}
