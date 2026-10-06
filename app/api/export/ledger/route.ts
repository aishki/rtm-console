import { ledgerCsv } from "@/lib/csv/export";
import { scopeLedger } from "@/lib/engine/scope";
import { authorizeFor } from "@/lib/server/guard";

/** Instance ledger for the caller's span, as CSV. */
export async function GET() {
  const ctx = await authorizeFor("export");
  if (ctx instanceof Response) return ctx;
  return new Response(ledgerCsv(scopeLedger(ctx.S, ctx.view, ctx.S.ledger)), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="RTM_instance_ledger.csv"', "Cache-Control": "no-store" },
  });
}
