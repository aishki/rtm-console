import { readSheets } from "@/lib/import/xlsx";
import { mergeQueueMap, parseQueueMap } from "@/lib/import/queueMap";
import { queueKey } from "@/lib/queueStats";
import { authorizeFor, deny } from "@/lib/server/guard";
import { loadQueueMap, saveQueueMap } from "@/lib/server/queueMapStore";
import { liveRuntime } from "@/lib/server/runtime";
import type { QueueMapResult } from "@/lib/types";
import { importErrors, isWorkbook, uploadedFile } from "@/lib/server/upload";

/**
 * Replace the queue-to-LOB mapping for the towers in an uploaded WFM workbook. Admin only.
 * multipart/form-data: file (.xlsx). Works on the live feed too: it does not touch the floor.
 */
export async function POST(req: Request) {
  const ctx = await authorizeFor("mapping");
  if (ctx instanceof Response) return ctx;
  const up = await uploadedFile(req);
  if (up instanceof Response) return up;
  if (!(await isWorkbook(up.file))) return deny(400, "Upload the .xlsx file WFM sends.");

  let sheets;
  try { sheets = await readSheets(await up.file.arrayBuffer()); } catch {
    return importErrors(["The file could not be opened as an Excel workbook (.xlsx)."]);
  }
  const parsed = parseQueueMap(sheets);
  if (!parsed.ok) return importErrors(parsed.errors);

  const merged = mergeQueueMap(loadQueueMap(), parsed.rows);
  saveQueueMap(merged);

  const mapped = new Set(merged.map(r => queueKey(r.queue)));
  const unmappedWatched = liveRuntime().engine.S.org.map(t => t.team).filter(team => !mapped.has(queueKey(team)));
  const result: QueueMapResult = {
    queues: merged.length,
    towers: [...new Set(parsed.rows.map(r => r.tower))],
    unmappedWatched,
    skipped: parsed.skipped,
    duplicates: parsed.duplicates,
  };
  return Response.json(result);
}
