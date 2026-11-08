import { severalLobsCsv } from "@/lib/csv/export";
import { severalLobs } from "@/lib/engine/scope";
import { authorizeFor } from "@/lib/server/guard";

/** Admins only: agents whose queues are in more than one LOB, as CSV, with the LOB their rules follow. */
export async function GET() {
  const ctx = await authorizeFor("mapping");
  if (ctx instanceof Response) return ctx;
  return new Response(severalLobsCsv(severalLobs(ctx.S)), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="RTM_agents_in_several_LOBs.csv"', "Cache-Control": "no-store" },
  });
}
