import { type CsvCols, type MappedState, buildEvents, distinctStatuses, guessCols, guessState, parseCSV, splitTable } from "@/lib/csv/parse";
import { STATE_OPTIONS } from "@/lib/engine/rules";
import { resolveView } from "@/lib/engine/scope";
import { authorizeFor, deny } from "@/lib/server/guard";
import { type Runtime, exitReplay, startReplay } from "@/lib/server/runtime";
import { writeView } from "@/lib/server/session";
import { importErrors, isWorkbook, readFloorWorkbook, uploadedFile } from "@/lib/server/upload";

const STATE_KEYS = new Set<string>(STATE_OPTIONS.map(o => o[0]));

function parseJson(v: FormDataEntryValue | null): Record<string, unknown> {
  if (typeof v !== "string") return {};
  try {
    const x: unknown = JSON.parse(v);
    return x && typeof x === "object" ? (x as Record<string, unknown>) : {};
  } catch { return {}; }
}

/** A raw Gencloud agent-status CSV: columns and statuses are mapped by the caller or guessed. */
async function fromCsv(sid: string, file: File, form: FormData): Promise<Runtime | Response> {
  const all = parseCSV(await file.text());
  if (all.length < 2) return deny(400, "Could not read the file: fewer than 2 rows found.");
  const { headers, rows } = splitTable(all);

  const cols: CsvCols = guessCols(headers);
  const given = parseJson(form.get("cols"));
  for (const k of ["agent", "status", "start", "team"] as const) {
    const v = given[k];
    if (typeof v === "number" && Number.isInteger(v) && v >= (k === "team" ? -1 : 0) && v < headers.length) cols[k] = v;
  }
  const givenMap = parseJson(form.get("smap"));
  const smap: Record<string, MappedState> = {};
  for (const s of distinctStatuses(rows, cols.status)) {
    const v = givenMap[s];
    smap[s] = typeof v === "string" && STATE_KEYS.has(v) ? (v as MappedState) : guessState(s);
  }

  const res = buildEvents(rows, cols, smap);
  if ("error" in res) return deny(400, res.error);
  return startReplay(sid, res.events);
}

/** A filled-in floor data template: roster, statuses, and optionally holds and queue intervals. */
async function fromWorkbook(sid: string, file: File): Promise<Runtime | Response> {
  const res = await readFloorWorkbook(file);
  if (!res.ok) return importErrors(res.errors);
  const { events, ...extras } = res.data;
  return startReplay(sid, events, extras);
}

/**
 * Start a replay for this session from an uploaded file.
 * multipart/form-data: file (.xlsx template, or a .csv status export with optional
 * cols = {agent,status,start,team} column indexes and smap = status -> state).
 */
export async function POST(req: Request) {
  const ctx = await authorizeFor("replay");
  if (ctx instanceof Response) return ctx;
  const up = await uploadedFile(req);
  if (up instanceof Response) return up;

  const rt = (await isWorkbook(up.file)) ? await fromWorkbook(ctx.sid, up.file) : await fromCsv(ctx.sid, up.file, up.form);
  if (rt instanceof Response) return rt;
  // The replay has its own org, so snap the session onto a person that exists in it.
  const view = resolveView(rt.engine.S, ctx.view);
  await writeView(view);
  return Response.json({ view, replay: rt.engine.S.replay });
}

/** Exit the replay and return this session to the live feed. */
export async function DELETE() {
  const ctx = await authorizeFor("replay");
  if (ctx instanceof Response) return ctx;
  exitReplay(ctx.sid);
  return Response.json({ ok: true });
}
