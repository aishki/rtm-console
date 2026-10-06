import { TEMPLATE_FILENAME, XLSX_MIME, buildTemplate } from "@/lib/import/xlsx";
import { authorizeFor } from "@/lib/server/guard";

/** The Excel template to fill in and upload. It ships with a sample day. */
export async function GET() {
  const ctx = await authorizeFor("replay");
  if (ctx instanceof Response) return ctx;
  return new Response(await buildTemplate(), {
    headers: { "Content-Type": XLSX_MIME, "Content-Disposition": `attachment; filename="${TEMPLATE_FILENAME}"`, "Cache-Control": "no-store" },
  });
}
