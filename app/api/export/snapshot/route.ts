import { authorize, deny } from "@/lib/server/guard";
import { dashboardHtml, snapshotData, snapshotFileName } from "@/lib/snapshot/dashboard";

/** The caller's Dashboards screen as a self-contained, read-only HTML file. Open to every role that has the Dashboards tab. */
export async function GET() {
  const ctx = await authorize();
  if (ctx instanceof Response) return ctx;
  if (!ctx.perms.tabs.includes("dash")) return deny(403, "Your role does not allow this action.");
  const now = new Date();
  return new Response(dashboardHtml(snapshotData(ctx.S, ctx.view, ctx.rt.feed.kind, now)), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="${snapshotFileName(now)}"`, "Cache-Control": "no-store" },
  });
}
