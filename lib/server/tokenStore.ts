import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";

// The Genesys bearer token an admin pasted on /admin/token, kept on this machine so it outlives
// a restart. It wins over GENESYS_TOKEN, which only seeds the first start. The folder is
// gitignored. The token is never logged.

const FILE = path.join(process.cwd(), ".rtm", "genesys-token");

let cached: string | null | undefined;

function stored(file: string): string | null {
  try { return readFileSync(file, "utf8").trim() || null; } catch { return null; }
}

/** The token the Gencloud feed should use: the last one pasted, else GENESYS_TOKEN. */
export function genesysToken(file = FILE): string | undefined {
  if (file !== FILE) return stored(file) ?? process.env.GENESYS_TOKEN;
  if (cached === undefined) cached = stored(file);
  return cached ?? process.env.GENESYS_TOKEN;
}

export function saveGenesysToken(token: string, file = FILE): void {
  const t = token.trim();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, t, { encoding: "utf8", mode: 0o600 });
  if (file === FILE) cached = t || null;
}

/** True when `secret` matches the configured admin secret. An unset secret matches nothing. */
export function validAdminSecret(secret: string, configured = process.env.RTM_ADMIN_SECRET ?? ""): boolean {
  if (!configured) return false;
  const a = Buffer.from(secret), b = Buffer.from(configured);
  return a.length === b.length && timingSafeEqual(a, b);
}
