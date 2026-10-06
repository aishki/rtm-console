import { type ImportResult, buildFloorImport } from "@/lib/import/floor";
import { readSheets } from "@/lib/import/xlsx";
import { deny } from "./guard";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** The uploaded file from a multipart request, or the response to send back instead. */
export async function uploadedFile(req: Request): Promise<{ file: File; form: FormData } | Response> {
  let form: FormData;
  try { form = await req.formData(); } catch { return deny(400, "Send the file as multipart/form-data."); }
  const file = form.get("file");
  if (!(file instanceof File)) return deny(400, "Attach the file in the file field.");
  if (file.size > MAX_UPLOAD_BYTES) return deny(413, "The file is larger than 10 MB.");
  return { file, form };
}

/** Excel workbooks are zip archives; a CSV never starts with these bytes. */
export async function isWorkbook(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b;
}

/** Read and validate a filled-in floor data template. */
export async function readFloorWorkbook(file: File): Promise<ImportResult> {
  try {
    return buildFloorImport(await readSheets(await file.arrayBuffer()));
  } catch {
    return { ok: false, errors: ["The file could not be opened as an Excel workbook (.xlsx)."] };
  }
}

/** 400 response listing every problem found in the workbook. */
export const importErrors = (errors: string[]): Response => Response.json({ error: errors[0], errors }, { status: 400 });
