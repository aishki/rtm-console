import { deny, readJson } from "@/lib/server/guard";
import { restartGencloud } from "@/lib/server/runtime";
import { saveGenesysToken, validAdminSecret } from "@/lib/server/tokenStore";

const API_BASE = process.env.GENCLOUD_API_BASE ?? "https://api.mypurecloud.com";

/**
 * Replace the Genesys bearer token without restarting the server: { secret, token }.
 * Guarded by RTM_ADMIN_SECRET rather than the session, because "View as" lets anyone be Admin
 * until SSO exists. The token is checked against Genesys before it is kept.
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  const secret = typeof body.secret === "string" ? body.secret : "";
  const token = typeof body.token === "string" ? body.token.trim().replace(/^Bearer\s+/i, "") : "";
  if (!validAdminSecret(secret)) return deny(401, "Wrong admin secret.");
  if (!token) return deny(400, "Paste a bearer token.");
  let who: string | undefined;
  try {
    const res = await fetch(`${API_BASE}/api/v2/users/me`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (res.status !== 200) return deny(400, "Genesys rejected the token. Copy a fresh one and try again.");
    who = ((await res.json()) as { name?: string }).name;
  } catch {
    return deny(502, "Could not reach Genesys to check the token.");
  }
  saveGenesysToken(token);
  restartGencloud();
  return Response.json({ ok: true, who: who ?? null });
}
