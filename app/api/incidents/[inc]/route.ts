import { authorizeFor, deny, readJson } from "@/lib/server/guard";
import { DISPOSITIONS } from "@/lib/engine/rules";
import { scopeIncidents } from "@/lib/engine/scope";

/** Move an investigation along: { action: "start" } or { action: "close", disposition }. */
export async function POST(req: Request, { params }: { params: Promise<{ inc: string }> }) {
  const ctx = await authorizeFor("invAct");
  if (ctx instanceof Response) return ctx;
  const { inc } = await params;
  const incident = scopeIncidents(ctx.S, ctx.view, ctx.S.incidents).find(i => i.inc === inc);
  if (!incident) return deny(404, "Incident not found in your span.");
  const body = await readJson(req);
  if (body.action === "start") {
    if (incident.status !== "Open") return deny(409, `Incident is already ${incident.status.toLowerCase()}.`);
    ctx.rt.engine.invAction(inc);
  } else if (body.action === "close") {
    if (incident.status !== "Investigating") return deny(409, "Start the investigation before closing it.");
    if (typeof body.disposition !== "string" || !DISPOSITIONS.includes(body.disposition)) return deny(400, "Pick a disposition.");
    ctx.rt.engine.invAction(inc, body.disposition);
  } else return deny(400, "Unknown action.");
  ctx.rt.publish();
  return Response.json({ incident });
}
