import type { QueueMapRow } from "@/lib/import/queueMap";

// The Genesys organizations the console can watch, one at a time. Each lives in a region with its
// own API address, and has its own token, users and queues. Shared by the server and the dev bar.

export type OrgId = "commercial" | "gbd" | "specialty";

export interface GenesysOrg {
  id: OrgId;
  /** As the queue map's Org column writes it. */
  name: string;
  region: "US East" | "US West";
  apiBase: string;
}

export const ORGS: GenesysOrg[] = [
  { id: "commercial", name: "Anthem Commercial", region: "US East", apiBase: "https://api.mypurecloud.com" },
  { id: "gbd", name: "Anthem GBD", region: "US West", apiBase: "https://api.usw2.pure.cloud" },
  { id: "specialty", name: "Anthem Specialty", region: "US West", apiBase: "https://api.usw2.pure.cloud" },
];

export const DEFAULT_ORG: OrgId = "commercial";

export const isOrgId = (x: unknown): x is OrgId => ORGS.some(o => o.id === x);
export const orgOf = (id: OrgId): GenesysOrg => ORGS.find(o => o.id === id)!;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The queue map's queues for an org, by its Org column. A row with no Org applies to every org. */
export function queueNamesFor(rows: QueueMapRow[], org: OrgId): string[] {
  const name = norm(orgOf(org).name);
  return rows.filter(r => !r.org || norm(r.org) === name).map(r => r.queue);
}
