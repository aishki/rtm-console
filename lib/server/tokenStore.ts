import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { DEFAULT_ORG, type OrgId, isOrgId } from "@/lib/orgs";

// Each org's Genesys bearer token, as an admin pasted it on /admin/token, and which org the
// floor watches. Kept on this machine so they outlive a restart; the folder is gitignored.
// An org's env variable (TOKEN_ENV) only seeds it until a token is pasted. The token is never logged.

const DIR = () => path.join(process.cwd(), ".rtm");

/** The env variable that seeds each org's token. */
export const TOKEN_ENV: Record<OrgId, string> = { commercial: "GENESYS_TOKEN", gbd: "GBD_TOKEN", specialty: "SPECIALTY_TOKEN" };

/** Commercial keeps the file it had before there were several orgs. */
export const tokenFile = (org: OrgId, dir = DIR()): string => path.join(dir, org === "commercial" ? "genesys-token" : `genesys-token.${org}`);

const cached = new Map<string, string | null>();

function stored(file: string): string | null {
  try { return readFileSync(file, "utf8").trim() || null; } catch { return null; }
}

/** The token an org's feed should use: the last one pasted, else its env variable (TOKEN_ENV). */
export function genesysToken(org: OrgId = DEFAULT_ORG, dir?: string): string | undefined {
  const file = tokenFile(org, dir);
  if (!dir && !cached.has(file)) cached.set(file, stored(file));
  const token = dir ? stored(file) : cached.get(file);
  return token ?? (process.env[TOKEN_ENV[org]]?.trim().replace(/^Bearer\s+/i, "") || undefined);
}

export function saveGenesysToken(org: OrgId, token: string, dir?: string): void {
  const file = tokenFile(org, dir), t = token.trim();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, t, { encoding: "utf8", mode: 0o600 });
  if (!dir) cached.set(file, t || null);
}

const orgFile = (dir = DIR()) => path.join(dir, "genesys-org");

/** The org the floor watched last, so a restart comes back to it. */
export function loadActiveOrg(dir?: string): OrgId {
  const id = stored(orgFile(dir));
  return isOrgId(id) ? id : DEFAULT_ORG;
}

export function saveActiveOrg(org: OrgId, dir?: string): void {
  const file = orgFile(dir);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, org);
  } catch { /* the floor still switches; a restart goes back to the default org */ }
}

/** True when `secret` matches the configured admin secret. An unset secret matches nothing. */
export function validAdminSecret(secret: string, configured = process.env.RTM_ADMIN_SECRET ?? ""): boolean {
  if (!configured) return false;
  const a = Buffer.from(secret), b = Buffer.from(configured);
  return a.length === b.length && timingSafeEqual(a, b);
}
