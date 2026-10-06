import { authorize, deny, readJson } from "@/lib/server/guard";
import { canComment } from "@/lib/engine/scope";

/** Attach the associate's reason to their own call-out: { text, ack? }. */
export async function POST(req: Request, { params }: { params: Promise<{ n: string }> }) {
  const ctx = await authorize();
  if (ctx instanceof Response) return ctx;
  if (ctx.view.role !== "agent") return deny(403, "Only the associate can attach a reason to their call-out.");
  const n = Number((await params).n);
  const rec = ctx.S.ledger.find(r => r.n === n);
  if (!rec || !canComment(ctx.view, rec)) return deny(404, "Instance not found.");
  const body = await readJson(req);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return deny(400, "Nothing to save.");
  if (text.length > 140) return deny(400, "Reasons are limited to 140 characters.");
  const instance = ctx.rt.engine.comment(n, text, body.ack === true);
  ctx.rt.publish();
  return Response.json({ instance });
}
