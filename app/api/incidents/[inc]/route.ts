import { authorizeFor, deny, readJson } from "@/lib/server/guard";
import { DISPOSITIONS, NOTE_MAX, PENDING_DISPOSITION, canClose } from "@/lib/engine/rules";
import { scopeIncidents } from "@/lib/engine/scope";

/**
 * Move an investigation along: { action: "start" } (the caller owns it), { action: "reopen" } (back to Open),
 * { action: "record", disposition }, { action: "note", text } (the investigation's notes; empty clears them)
 * or { action: "close", text? } (the closing note; needs a final disposition, not "Pending Investigation").
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
  } else if (body.action === "note") {
    if (!investigating) return deny(409, "Notes can be kept only while the incident is being investigated.");
    if (typeof body.text !== "string") return deny(400, "Send the notes as text.");
  } else if (body.action === "close") {
    if (!investigating) return deny(409, "Start the investigation before closing the incident.");
    if (!canClose(incident.disposition)) {
      return deny(409, incident.disposition === PENDING_DISPOSITION
        ? "Change the disposition from Pending Investigation to a final outcome before closing."
        : "Record a disposition before closing the incident.");
    }
  } else return deny(400, "Unknown action.");
  if (typeof body.text === "string" && body.text.length > NOTE_MAX) return deny(400, `Keep notes under ${NOTE_MAX} characters.`);
  const value = body.action === "record" ? body.disposition : body.text;
  ctx.rt.engine.invAction(inc, body.action, typeof value === "string" ? value : undefined, ctx.view);
  ctx.rt.publish();
  return Response.json({ incident });
}
