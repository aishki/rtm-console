import { authorizeImport } from "@/lib/server/guard";
import { importErrors, isWorkbook, readFloorWorkbook, uploadedFile } from "@/lib/server/upload";

/** Check a filled-in template without starting anything: returns a summary and warnings, or every error. */
export async function POST(req: Request) {
  const ctx = await authorizeImport();
  if (ctx instanceof Response) return ctx;
  const up = await uploadedFile(req);
  if (up instanceof Response) return up;
  if (!(await isWorkbook(up.file))) return importErrors(["This is not an Excel workbook. Upload the filled-in .xlsx template."]);
  const res = await readFloorWorkbook(up.file);
  if (!res.ok) return importErrors(res.errors);
  return Response.json({ summary: res.summary, warnings: res.warnings });
}
