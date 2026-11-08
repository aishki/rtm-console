import { unsupervisedCsv } from "@/lib/csv/export";
import { unsupervised } from "@/lib/engine/scope";
import { authorizeFor } from "@/lib/server/guard";

/** Admins only: agents on the floor with no supervisor in Genesys or the CGS directory, as CSV, to have fixed in Genesys. */
export async function GET() {
  const ctx = await authorizeFor("mapping");
  if (ctx instanceof Response) return ctx;
  return new Response(unsupervisedCsv(unsupervised(ctx.S)), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="RTM_agents_without_supervisor.csv"', "Cache-Control": "no-store" },
  });
}
