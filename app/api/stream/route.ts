import { authorize } from "@/lib/server/guard";
import { initMsg, tickMsg } from "@/lib/server/snapshot";
import type { StreamMsg } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Server-sent events: one scoped snapshot on connect, then a delta every engine second. */
export async function GET(req: Request) {
  const ctx = await authorize();
  if (ctx instanceof Response) return ctx;
  const { rt, view } = ctx;
  const enc = new TextEncoder();
  let close = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (msg: StreamMsg) => controller.enqueue(enc.encode(`data: ${JSON.stringify(msg)}\n\n`));
      let rev = rt.engine.S.rev;
      send(initMsg(rt, view));
      const unsubscribe = rt.subscribe(batch => {
        const msg = tickMsg(rt, view, rev, batch);
        rev = rt.engine.S.rev;
        try { send(msg); } catch { close(); }
      });
      close = () => {
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      };
      req.signal.addEventListener("abort", close);
    },
    cancel() { close(); },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
