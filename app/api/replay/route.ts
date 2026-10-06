import { type CsvCols, type MappedState, buildEvents, distinctStatuses, guessCols, guessState, parseCSV, splitTable } from "@/lib/csv/parse";
import { STATE_OPTIONS } from "@/lib/engine/rules";
import { resolveView } from "@/lib/engine/scope";
import { authorizeFor, deny } from "@/lib/server/guard";
import { exitReplay, startReplay } from "@/lib/server/runtime";
import { writeView } from "@/lib/server/session";

const MAX_BYTES = 10 * 1024 * 1024;
const STATE_KEYS = new Set<string>(STATE_OPTIONS.map(o => o[0]));

function parseJson(v: FormDataEntryValue | null): Record<string, unknown> {
  if (typeof v !== "string") return {};
  try {
    const x: unknown = JSON.parse(v);
    return x && typeof x === "object" ? (x as Record<string, unknown>) : {};
  } catch { return {}; }
}

/**
 * Start a replay job from a Gencloud agent-status export.
 * multipart/form-data: file (CSV), cols? ({agent,status,start,team} column indexes), smap? (status -> state).
 */
export async function POST(req: Request) {
  const ctx = await authorizeFor("replay");
  if (ctx instanceof Response) return ctx;
  let form: FormData;
  try { form = await req.formData(); } catch { return deny(400, "Send the export as multipart/form-data."); }
  const file = form.get("file");
  if (!(file instanceof File)) return deny(400, "Attach the CSV in the file field.");
  if (file.size > MAX_BYTES) return deny(413, "The export is larger than 10 MB.");

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
  const rt = startReplay(ctx.sid, res.events);
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
