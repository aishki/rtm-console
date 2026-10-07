import { authorizeFor, deny, readJson } from "@/lib/server/guard";
import { setFloorSource } from "@/lib/server/runtime";
import { usesRealNames } from "@/lib/server/snapshot";

/**
 * Switch the floor between the Gencloud feed and the simulator, for everyone. Open streams
 * follow by themselves.
 */
export async function POST(req: Request) {
  const ctx = await authorizeFor("feed");
  if (ctx instanceof Response) return ctx;
  const { source } = await readJson(req);
  if (source !== "gencloud" && source !== "sim") return deny(400, "Unknown data source.");
  const rt = setFloorSource(source);
  return Response.json({ feed: rt.feed.kind, realNames: usesRealNames(rt) });
}
