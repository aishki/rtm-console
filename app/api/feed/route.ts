import { isOrgId } from "@/lib/orgs";
import { authorizeFor, deny, readJson } from "@/lib/server/guard";
import { setFloorSource } from "@/lib/server/runtime";
import { usesRealNames } from "@/lib/server/snapshot";

/**
 * Switch the floor between a Genesys org's feed and the simulator, for everyone:
 * { source, org? }, `org` naming the org for "gencloud" (default: the one shown last).
 * Open streams follow by themselves.
 */
export async function POST(req: Request) {
  const ctx = await authorizeFor("feed");
  if (ctx instanceof Response) return ctx;
  const { source, org } = await readJson(req);
  if (source !== "gencloud" && source !== "sim") return deny(400, "Unknown data source.");
  if (org !== undefined && (source !== "gencloud" || !isOrgId(org))) return deny(400, "Unknown org.");
  const rt = setFloorSource(source, org);
  return Response.json({ feed: rt.feed.kind, genesysOrg: rt.genesysOrg ?? null, realNames: usesRealNames(rt) });
}
