import { gencloudClient } from "@/lib/feed/GencloudFeed";
import type { WatchedQueue } from "@/lib/feed/gencloud/client";
import { isOrgId, orgOf } from "@/lib/orgs";
import { deny, readJson } from "@/lib/server/guard";
import { activeOrg, gencloudConfig, orgApiBase, restartGencloud } from "@/lib/server/runtime";
import { saveGenesysToken, validAdminSecret } from "@/lib/server/tokenStore";

const status = (e: unknown) => Number((e instanceof Error ? e.message : "").match(/HTTP (\d+)/)?.[1] ?? 0);

/**
 * Replace an org's Genesys bearer token without restarting the server: { secret, token, org? }.
 * `org` defaults to the org the floor watches. Guarded by RTM_ADMIN_SECRET rather than the
 * session, because "View as" lets anyone be Admin until SSO exists. Before the token is kept, it
 * must do what the feed does first, in that org's region: find the watched queues and read their
 * live numbers. A token Genesys accepts can still fail that, for example another user's saved
 * view (404), the wrong org, or an account without analytics permission (403). Queues in
 * divisions the token may not read are left out, as the feed does, and counted.
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  const secret = typeof body.secret === "string" ? body.secret : "";
  const token = typeof body.token === "string" ? body.token.trim().replace(/^Bearer\s+/i, "") : "";
  if (!validAdminSecret(secret)) return deny(401, "Wrong admin secret.");
  if (body.org !== undefined && !isOrgId(body.org)) return deny(400, "Unknown org.");
  const org = isOrgId(body.org) ? body.org : activeOrg();
  const { name, region } = orgOf(org);
  if (!token) return deny(400, "Paste a bearer token.");

  const apiBase = orgApiBase(org);
  const get = (path: string) => fetch(`${apiBase}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  let who: string | undefined, genesysOrg: string | undefined;
  try {
    const res = await get("/api/v2/users/me");
    if (res.status !== 200) return deny(400, `Genesys ${region} rejected the token. Copy a fresh one from a ${name} session and try again.`);
    who = ((await res.json()) as { name?: string }).name;
    // Shown back, so a token from the wrong org is easy to spot. Optional: not every account may read it.
    const o = await get("/api/v2/organizations/me").catch(() => null);
    if (o?.ok) genesysOrg = ((await o.json()) as { name?: string }).name;
  } catch {
    return deny(502, "Could not reach Genesys to check the token.");
  }

  const config = gencloudConfig(org);
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
      ? `None of the queue map's ${name} queues are in this token's Genesys org${genesysOrg ? ` (${genesysOrg})` : ""}. Use a token from ${name}.`
      : config.viewConfigId === "" ? `The queue map has no ${name} queues yet. Upload a mapping with them first.` : "The saved Genesys view the console watches has no queues.");
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

  saveGenesysToken(org, token);
  restartGencloud(org);
  return Response.json({ ok: true, org, who: who ?? null, genesysOrg: genesysOrg ?? null, queues: readable.length, forbidden: forbidden.length });
}
