import { incidentsCsv } from "@/lib/csv/export";
import { scopeIncidents } from "@/lib/engine/scope";
import { authorizeFor } from "@/lib/server/guard";

/** Investigation register for the caller's span, as CSV. */
export async function GET() {
  const ctx = await authorizeFor("export");
  if (ctx instanceof Response) return ctx;
  return new Response(incidentsCsv(scopeIncidents(ctx.S, ctx.view, ctx.S.incidents)), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="RTM_investigation_register.csv"', "Cache-Control": "no-store" },
  });
}
