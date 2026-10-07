import { resolveView } from "@/lib/engine/scope";
import { deny, readJson } from "@/lib/server/guard";
import { parseSubscription, pushKey, removeSubscription, saveSubscription } from "@/lib/server/push";
import { liveRuntime } from "@/lib/server/runtime";
import { readSession } from "@/lib/server/session";

/** The key a browser needs to subscribe to desktop alerts; null when push is not configured. */
export async function GET() {
  if (!(await readSession())) return deny(401, "Not signed in.");
  return Response.json({ key: pushKey });
}

/** Register this browser for the caller's desktop alerts. Alerts always follow the live floor, never a replay. */
export async function POST(req: Request) {
  const session = await readSession();
  if (!session) return deny(401, "Not signed in.");
  if (!pushKey) return deny(503, "Desktop alerts are not configured on this server.");
  const sub = parseSubscription((await readJson(req)).subscription);
  if (!sub) return deny(400, "Not a push subscription.");
  saveSubscription(resolveView(liveRuntime().engine.S, session.view), sub);
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!(await readSession())) return deny(401, "Not signed in.");
  const { endpoint } = await readJson(req);
  if (typeof endpoint === "string") removeSubscription(endpoint);
  return Response.json({ ok: true });
}
