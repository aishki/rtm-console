import { gencloudClient } from "@/lib/feed/GencloudFeed";
import type { WatchedQueue } from "@/lib/feed/gencloud/client";
import { deny, readJson } from "@/lib/server/guard";
import { gencloudConfig, restartGencloud } from "@/lib/server/runtime";
import { saveGenesysToken, validAdminSecret } from "@/lib/server/tokenStore";

const API_BASE = process.env.GENCLOUD_API_BASE ?? "https://api.mypurecloud.com";

const status = (e: unknown) => Number((e instanceof Error ? e.message : "").match(/HTTP (\d+)/)?.[1] ?? 0);

/**
 * Replace the Genesys bearer token without restarting the server: { secret, token }.
 * Guarded by RTM_ADMIN_SECRET rather than the session, because "View as" lets anyone be Admin
 * until SSO exists. Before the token is kept, it must do what the feed does first: find the
 * watched queues and read their live numbers. A token Genesys accepts can still fail that, for
 * example another user's saved view (404) or an account without analytics permission (403).
 * Queues in divisions the token may not read are left out, as the feed does, and counted.
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

  const config = gencloudConfig();
  const fromMap = (config.getQueueNames?.() ?? []).length > 0;
  const client = gencloudClient(config, token);
  let queues: WatchedQueue[];
  try {
    queues = await client.getWatchedQueues();
  } catch (e) {
    const s = status(e);
    if (!fromMap && s === 404) return deny(400, `${who ?? "This account"} cannot see the saved Genesys view the console watches (RTM_VIEW_CONFIG_ID); a saved view belongs to the user who saved it. Upload the queue map, or use a token from that user.`);
    if (s === 403) return deny(400, `${who ?? "This account"} is not allowed to list queues in Genesys.`);
    if (s) return deny(400, `Genesys refused to list the watched queues for this token (HTTP ${s}).`);
    return deny(502, "Could not reach Genesys to check the token.");
  }
  if (queues.length === 0) {
    return deny(400, fromMap
      ? "None of the queue map's queues are in this token's Genesys org. Use a token from the org the queues belong to."
      : "The saved Genesys view the console watches has no queues.");
  }
  let readable: WatchedQueue[], forbidden: WatchedQueue[];
  try {
    ({ readable, forbidden } = await client.readableQueues(queues));
  } catch (e) {
    const s = status(e);
    if (s) return deny(400, `Genesys refused the queue statistics for this token (HTTP ${s}).`);
    return deny(502, "Could not reach Genesys to check the token.");
  }
  if (readable.length === 0) return deny(400, `${who ?? "This account"} is not allowed to read the watched queues' statistics in Genesys (analytics permission).`);

  saveGenesysToken(token);
  restartGencloud();
  return Response.json({ ok: true, who: who ?? null, queues: readable.length, forbidden: forbidden.length });
}
