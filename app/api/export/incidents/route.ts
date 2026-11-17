import { incidentsCsv } from "@/lib/csv/export";
import { incidentMatches, readFilter } from "@/lib/listFilters";
import { scopeIncidents } from "@/lib/engine/scope";
import { authorizeFor } from "@/lib/server/guard";

/** Investigation register for the caller's span, as CSV: only the rows the screen's search and queue filter show (`q`, `queue`). */
export async function GET(req: Request) {
  const ctx = await authorizeFor("export");
  if (ctx instanceof Response) return ctx;
  return new Response(incidentsCsv(scopeIncidents(ctx.S, ctx.view, ctx.S.incidents).filter(incidentMatches(readFilter(new URL(req.url).searchParams)))), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="RTM_investigation_register.csv"', "Cache-Control": "no-store" },
  });
}
