import type { Cell, Sheet } from "@/lib/import/floor";
import { queueKey } from "@/lib/queueStats";

// Reads the WFM queue-to-LOB mapping spreadsheet. Pure: it takes plain rows.

export interface QueueMapRow { tower: string; subTower: string; lob: string; queue: string; region?: string; org?: string }
export type QueueMapParse =
  | { ok: true; rows: QueueMapRow[]; skipped: { row: number; reason: string }[]; duplicates: { queue: string; kept: string; dropped: string }[] }
  | { ok: false; errors: string[] };

const SHEET_NAME = "queue-to-lob mapping";
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[\s-]/g, "");
const text = (c: Cell | undefined) => (c === null || c === undefined ? "" : c instanceof Date ? c.toISOString() : String(c).trim());

const REQUIRED = [
  { key: "tower", label: "Tower", aliases: ["tower"] },
  { key: "subTower", label: "Sub-tower", aliases: ["subtower"] },
  { key: "lob", label: "LOB", aliases: ["lob"] },
  { key: "queue", label: "Queue", aliases: ["queue", "queues"] },
] as const;
const OPTIONAL = [
  { key: "region", aliases: ["region"] },
  { key: "org", aliases: ["org", "organization"] },
] as const;

export function parseQueueMap(sheets: Record<string, Sheet>): QueueMapParse {
  const name = Object.keys(sheets).find(n => n.trim().toLowerCase() === SHEET_NAME);
  if (name === undefined) return { ok: false, errors: ['No sheet named "Queue-to-LOB mapping".'] };
  const [header = [], ...body] = sheets[name];
  const heads = header.map(norm);
  const at = (aliases: readonly string[]) => heads.findIndex(h => aliases.includes(h));

  const missing = REQUIRED.find(c => at(c.aliases) < 0);
  if (missing) return { ok: false, errors: [`Missing column: ${missing.label}.`] };

  const req = REQUIRED.map(c => ({ ...c, col: at(c.aliases) }));
  const opt = OPTIONAL.map(c => ({ ...c, col: at(c.aliases) })).filter(c => c.col >= 0);

  const rows: QueueMapRow[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const duplicates: { queue: string; kept: string; dropped: string }[] = [];
  const seen = new Map<string, QueueMapRow>();

  body.forEach((cells, i) => {
    const row = i + 2;
    if (cells.every(c => text(c) === "")) return;
    const lacking = req.find(c => text(cells[c.col]) === "");
    if (lacking) { skipped.push({ row, reason: `Missing ${lacking.label}` }); return; }
    const out: QueueMapRow = {
      tower: text(cells[req[0].col]),
      subTower: text(cells[req[1].col]),
      lob: text(cells[req[2].col]),
      queue: text(cells[req[3].col]),
    };
    for (const c of opt) { const v = text(cells[c.col]); if (v) out[c.key] = v; }
    const first = seen.get(queueKey(out.queue));
    if (first) { duplicates.push({ queue: out.queue, kept: first.lob, dropped: out.lob }); return; }
    seen.set(queueKey(out.queue), out);
    rows.push(out);
  });
  return { ok: true, rows, skipped, duplicates };
}

/** An upload replaces every tower it contains and leaves the other towers as they were. */
export function mergeQueueMap(current: QueueMapRow[], incoming: QueueMapRow[]): QueueMapRow[] {
  const towers = new Set(incoming.map(r => r.tower));
  return [...current.filter(r => !towers.has(r.tower)), ...incoming];
}
