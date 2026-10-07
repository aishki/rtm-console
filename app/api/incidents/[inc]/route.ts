import { authorizeFor, deny, readJson } from "@/lib/server/guard";
import { DISPOSITIONS } from "@/lib/engine/rules";
import { scopeIncidents } from "@/lib/engine/scope";

/**
 * Move an investigation along: { action: "start" }, { action: "reopen" } (back to Open),
 * { action: "record", disposition } or { action: "close" } (needs a recorded disposition).
 */
export async function POST(req: Request, { params }: { params: Promise<{ inc: string }> }) {
  const ctx = await authorizeFor("invAct");
  if (ctx instanceof Response) return ctx;
  const { inc } = await params;
  const incident = scopeIncidents(ctx.S, ctx.view, ctx.S.incidents).find(i => i.inc === inc);
  if (!incident) return deny(404, "Incident not found in your span.");
  const body = await readJson(req);
  const investigating = incident.status === "Investigating";
  if (body.action === "start") {
    if (incident.status !== "Open") return deny(409, `Incident is already ${incident.status.toLowerCase()}.`);
  } else if (body.action === "reopen") {
    if (!investigating) return deny(409, "Only an investigation in progress can go back to open.");
  } else if (body.action === "record") {
    if (!investigating) return deny(409, "Start the investigation before recording a disposition.");
    if (typeof body.disposition !== "string" || !DISPOSITIONS.includes(body.disposition)) return deny(400, "Pick a disposition.");
  } else if (body.action === "close") {
    if (!investigating) return deny(409, "Start the investigation before closing it.");
    if (!incident.disposition) return deny(409, "Record a disposition before closing the investigation.");
  } else return deny(400, "Unknown action.");
  ctx.rt.engine.invAction(inc, body.action, typeof body.disposition === "string" ? body.disposition : undefined);
  ctx.rt.publish();
  return Response.json({ incident });
}
