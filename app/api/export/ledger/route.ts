import { ledgerCsv } from "@/lib/csv/export";
import { ledgerMatches, readFilter } from "@/lib/listFilters";
import { scopeLedger } from "@/lib/engine/scope";
import { authorizeFor } from "@/lib/server/guard";

/** Instance ledger for the caller's span, as CSV: only the rows the screen's search and filters show (`q`, `queue`, `stage`). */
export async function GET(req: Request) {
  const ctx = await authorizeFor("export");
  if (ctx instanceof Response) return ctx;
  return new Response(ledgerCsv(scopeLedger(ctx.S, ctx.view, ctx.S.ledger).filter(ledgerMatches(readFilter(new URL(req.url).searchParams)))), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="RTM_instance_ledger.csv"', "Cache-Control": "no-store" },
  });
}
