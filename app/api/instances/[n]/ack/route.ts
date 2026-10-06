import { authorize, deny } from "@/lib/server/guard";
import { canAck } from "@/lib/engine/scope";

/** Acknowledge one call-out: leaders for their span, agents for their own nudges. */
export async function POST(_req: Request, { params }: { params: Promise<{ n: string }> }) {
  const ctx = await authorize();
  if (ctx instanceof Response) return ctx;
  if (ctx.view.role === "senior") return deny(403, "Your role does not allow this action.");
  const n = Number((await params).n);
  const rec = ctx.S.ledger.find(r => r.n === n);
  // Out-of-span instances are reported as missing so their existence is not revealed.
  if (!rec || !canAck(ctx.S, ctx.view, rec)) return deny(404, "Instance not found in your span.");
  const instance = ctx.rt.engine.ack(n);
  ctx.rt.publish();
  return Response.json({ instance });
}
