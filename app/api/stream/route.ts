import { resolveView } from "@/lib/engine/scope";
import { authorize } from "@/lib/server/guard";
import { liveRuntime, onFloorChange } from "@/lib/server/runtime";
import { initMsg, tickMsg } from "@/lib/server/snapshot";
import type { StreamMsg } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Server-sent events: one scoped snapshot on connect (and after a data source switch), then a delta every engine second. */
export async function GET(req: Request) {
  const ctx = await authorize();
  if (ctx instanceof Response) return ctx;
  let rt = ctx.rt;
  const enc = new TextEncoder();
  let close = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (msg: StreamMsg) => controller.enqueue(enc.encode(`data: ${JSON.stringify(msg)}\n\n`));
      let unsubscribe = () => {};
      const attach = () => {
        const view = resolveView(rt.engine.S, ctx.view);
        let rev = rt.engine.S.rev;
        send(initMsg(rt, view));
        unsubscribe = rt.subscribe(batch => {
          const msg = tickMsg(rt, view, rev, batch);
          rev = rt.engine.S.rev;
          try { send(msg); } catch { close(); }
        });
      };
      attach();
      // The floor's data source was switched: carry on from the new floor with a fresh snapshot.
      const unwatch = rt.kind === "live" ? onFloorChange(() => {
        unsubscribe();
        rt = liveRuntime();
        try { attach(); } catch { close(); }
      }) : () => {};
      close = () => {
        unwatch();
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
