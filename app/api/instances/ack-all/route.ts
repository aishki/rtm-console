import { authorizeFor } from "@/lib/server/guard";

/** Acknowledge every open instance in the caller's span. Admin only. */
export async function POST() {
  const ctx = await authorizeFor("ackAll");
  if (ctx instanceof Response) return ctx;
  const count = ctx.rt.engine.ackAll(ctx.view);
  ctx.rt.publish();
  return Response.json({ count });
}
