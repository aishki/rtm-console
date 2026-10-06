import type { AgentState, Queue, RosterAgent, Team } from "@/lib/types";
import { type ReplayEvent, guessState } from "@/lib/csv/parse";
import { STATES, STATE_IDS } from "@/lib/engine/rules";

// Turns the filled-in floor data template into something the replay feed can run.
// Pure: it takes plain rows, so it is independent of the spreadsheet library.

export type Cell = string | number | boolean | Date | null;
/** A worksheet as rows of cells; the first row is the header. */
export type Sheet = Cell[][];

export interface HoldEvent { agent: string; t: number; on: boolean }
export interface QueuePoint { t: number; queue: Queue }
export interface FloorImport { org: Team[]; roster: RosterAgent[]; events: ReplayEvent[]; holds: HoldEvent[]; queue: QueuePoint[] }
export interface ImportSummary { agents: number; teams: number; events: number; holds: number; queueIntervals: number; startT: number; endT: number }
export type ImportResult =
  | { ok: true; data: FloorImport; summary: ImportSummary; warnings: string[] }
  | { ok: false; errors: string[] };

/** Sheet and column names in the template. Matching ignores case, spaces and punctuation. */
export const SHEETS = { roster: "Roster", status: "Agent Status", holds: "Holds", queue: "Queue Intervals" } as const;
export const COLUMNS = {
  roster: ["Agent Name", "Team", "Team Lead", "Manager", "LOB", "Adherence %"],
  status: ["Agent Name", "Status", "Start Time", "Transferred"],
  holds: ["Agent Name", "Hold Start", "Hold End"],
  queue: ["Interval Start", "Calls Waiting", "Service Level %", "ASA (s)", "Abandon %"],
} as const;
export const STATUS_LABELS = STATE_IDS.map(id => STATES[id].label);

const MAX_LISTED = 8;
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9%]/g, "");
const text = (c: Cell | undefined) => (c === null || c === undefined ? "" : c instanceof Date ? c.toISOString() : String(c).trim());
const blank = (row: Cell[]) => row.every(c => text(c) === "");

/**
 * A cell as wall-clock seconds since the Unix epoch. Spreadsheet dates carry no timezone, so
 * the time shown in the cell is taken as is. Accepts date cells, Excel serial numbers,
 * "2026-10-01 08:00:00"-style text and bare "08:00:00" times.
 */
export function wallClock(c: Cell | undefined): number {
  if (c instanceof Date) return c.getTime() / 1000;
  if (typeof c === "number") return c >= 1 ? Math.round((c - 25569) * 86400) : c >= 0 ? Math.round(c * 86400) : NaN;
  const v = text(c);
  if (!v) return NaN;
  const time = v.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (time) {
    let h = +time[1] % (time[4] ? 12 : 24);
    if (time[4]?.toLowerCase() === "pm") h += 12;
    return h * 3600 + +time[2] * 60 + +(time[3] || 0);
  }
  const iso = Date.parse(v.replace(" ", "T").replace(/(Z|[+-]\d{2}:?\d{2})?$/, "Z"));
  if (!isNaN(iso)) return iso / 1000;
  const loose = new Date(v + " UTC").getTime();
  return isNaN(loose) ? NaN : loose / 1000;
}

function num(c: Cell | undefined): number | null {
  if (typeof c === "number") return isFinite(c) ? c : null;
  const v = text(c).replace(/[%,\s]/g, "");
  if (!v) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
const yes = (c: Cell | undefined) => /^(y|yes|true|1|x)$/i.test(text(c));

function stateFor(status: string, guessed: Map<string, AgentState>): AgentState {
  const exact = STATE_IDS.find(id => norm(STATES[id].label) === norm(status) || id === norm(status));
  if (exact) return exact;
  const g = guessState(status);
  guessed.set(status, g);
  return g;
}

class Table {
  readonly rows: { cells: Cell[]; line: number }[];
  private readonly headers: string[];
  constructor(sheet: Sheet) {
    this.headers = (sheet[0] ?? []).map(norm);
    this.rows = sheet.slice(1).map((cells, i) => ({ cells, line: i + 2 })).filter(r => !blank(r.cells));
  }
  /** Index of the first header matching any alias, or -1. */
  col(...aliases: string[]): number {
    for (const a of aliases) { const i = this.headers.indexOf(norm(a)); if (i >= 0) return i; }
    for (const a of aliases) { const i = this.headers.findIndex(h => h.includes(norm(a))); if (i >= 0) return i; }
    return -1;
  }
}

function capped(items: string[]): string {
  return items.slice(0, MAX_LISTED).join(", ") + (items.length > MAX_LISTED ? ` and ${items.length - MAX_LISTED} more` : "");
}

/** Validate the workbook's sheets and build the replay input. `sheets` is keyed by sheet name. */
export function buildFloorImport(sheets: Record<string, Sheet>): ImportResult {
  const errors: string[] = [], warnings: string[] = [];
  const byName = new Map(Object.entries(sheets).map(([k, v]) => [norm(k), v]));
  const sheet = (...names: string[]) => { for (const n of names) { const s = byName.get(norm(n)); if (s) return new Table(s); } return null; };
  const need = (t: Table, sheetName: string, label: string, ...aliases: string[]) => {
    const i = t.col(label, ...aliases);
    if (i < 0) errors.push(`Sheet "${sheetName}" is missing the "${label}" column.`);
    return i;
  };

  const rosterT = sheet(SHEETS.roster), statusT = sheet(SHEETS.status, "Status", "Statuses");
  if (!rosterT) errors.push(`Sheet "${SHEETS.roster}" is missing.`);
  if (!statusT) errors.push(`Sheet "${SHEETS.status}" is missing.`);
  if (!rosterT || !statusT) return { ok: false, errors };

  // ---------- Roster ----------
  const rc = {
    agent: need(rosterT, SHEETS.roster, "Agent Name", "Agent", "Name"), team: need(rosterT, SHEETS.roster, "Team"),
    tl: need(rosterT, SHEETS.roster, "Team Lead", "TL"), mgr: need(rosterT, SHEETS.roster, "Manager", "Mgr"),
    lob: rosterT.col("LOB", "Line of Business"), adh: rosterT.col("Adherence %", "Adherence"),
  };
  const roster: RosterAgent[] = [], teams = new Map<string, Team>(), names = new Set<string>();
  if (rc.agent >= 0 && rc.team >= 0 && rc.tl >= 0 && rc.mgr >= 0) {
    const dupes: string[] = [], incomplete: number[] = [], conflicts: string[] = [];
    for (const { cells, line } of rosterT.rows) {
      const name = text(cells[rc.agent]), team = text(cells[rc.team]), tl = text(cells[rc.tl]), mgr = text(cells[rc.mgr]);
      if (!name || !team || !tl || !mgr) { incomplete.push(line); continue; }
      if (names.has(name)) { dupes.push(name); continue; }
      const lob = (rc.lob >= 0 && text(cells[rc.lob])) || team;
      const known = teams.get(team);
      if (!known) teams.set(team, { team, tl, mgr, lob });
      else if (known.tl !== tl || known.mgr !== mgr) conflicts.push(team);
      names.add(name);
      const adh = rc.adh >= 0 ? num(cells[rc.adh]) : null;
      roster.push({ name, team, state: "off", stTime: 0, aht: 420, calls: 0, adh: adh === null ? 96 : Math.max(0, Math.min(100, adh <= 1 ? adh * 100 : adh)) });
    }
    if (incomplete.length) errors.push(`${SHEETS.roster}: rows ${capped(incomplete.map(String))} need an agent name, team, team lead and manager.`);
    if (dupes.length) errors.push(`${SHEETS.roster}: agent names must be unique. Repeated: ${capped([...new Set(dupes)])}.`);
    if (conflicts.length) errors.push(`${SHEETS.roster}: a team has one team lead and one manager. Conflicting rows for: ${capped([...new Set(conflicts)])}.`);
    if (!roster.length && !incomplete.length) errors.push(`${SHEETS.roster} has no agents.`);
  }

  // ---------- Agent Status ----------
  const sc = {
    agent: need(statusT, SHEETS.status, "Agent Name", "Agent", "User Name", "Name"), status: need(statusT, SHEETS.status, "Status", "Presence", "State"),
    start: need(statusT, SHEETS.status, "Start Time", "Start", "Timestamp", "Time"), xfer: statusT.col("Transferred", "Transfer"),
  };
  const guessed = new Map<string, AgentState>();
  const raw: { agent: string; state: AgentState; abs: number; transferred: boolean }[] = [];
  if (sc.agent >= 0 && sc.status >= 0 && sc.start >= 0) {
    const unknown = new Set<string>(), badTime: number[] = [], incomplete: number[] = [];
    for (const { cells, line } of statusT.rows) {
      const agent = text(cells[sc.agent]), status = text(cells[sc.status]);
      if (!agent || !status) { incomplete.push(line); continue; }
      const abs = wallClock(cells[sc.start]);
      if (isNaN(abs)) { badTime.push(line); continue; }
      if (names.size && !names.has(agent)) { unknown.add(agent); continue; }
      raw.push({ agent, state: stateFor(status, guessed), abs, transferred: sc.xfer >= 0 && yes(cells[sc.xfer]) });
    }
    if (incomplete.length) errors.push(`${SHEETS.status}: rows ${capped(incomplete.map(String))} need an agent name and a status.`);
    if (badTime.length) errors.push(`${SHEETS.status}: rows ${capped(badTime.map(String))} have a start time that could not be read. Use a date and time, e.g. 2026-10-01 08:00:00.`);
    if (unknown.size) errors.push(`${SHEETS.status}: these agents are not in the ${SHEETS.roster} sheet: ${capped([...unknown])}.`);
    if (raw.length < 2 && !errors.length) errors.push(`${SHEETS.status} needs at least two status rows to build a timeline.`);
  }

  // ---------- Holds (optional) ----------
  const rawHolds: { agent: string; abs: number; on: boolean }[] = [];
  const holdsT = sheet(SHEETS.holds, "Hold");
  if (holdsT?.rows.length) {
    const hc = { agent: need(holdsT, SHEETS.holds, "Agent Name", "Agent", "Name"), start: need(holdsT, SHEETS.holds, "Hold Start", "Start"), end: need(holdsT, SHEETS.holds, "Hold End", "End") };
    if (hc.agent >= 0 && hc.start >= 0 && hc.end >= 0) {
      const bad: number[] = [];
      for (const { cells, line } of holdsT.rows) {
        const agent = text(cells[hc.agent]), a = wallClock(cells[hc.start]), b = wallClock(cells[hc.end]);
        if (!agent || isNaN(a) || isNaN(b) || b <= a || !names.has(agent)) { bad.push(line); continue; }
        rawHolds.push({ agent, abs: a, on: true }, { agent, abs: b, on: false });
      }
      if (bad.length) warnings.push(`${SHEETS.holds}: skipped rows ${capped(bad.map(String))} (unknown agent, unreadable time, or end before start).`);
    }
  }

  // ---------- Queue Intervals (optional) ----------
  const rawQueue: { abs: number; cq: number | null; sl: number | null; asa: number | null; ab: number | null }[] = [];
  const queueT = sheet(SHEETS.queue, "Queue");
  if (queueT?.rows.length) {
    const qc = {
      start: need(queueT, SHEETS.queue, "Interval Start", "Start"), cq: queueT.col("Calls Waiting", "Waiting", "Calls in Queue"),
      sl: queueT.col("Service Level %", "Service Level"), asa: queueT.col("ASA (s)", "ASA"), ab: queueT.col("Abandon %"),
    };
    if (qc.start >= 0) {
      const bad: number[] = [];
      const at = (cells: Cell[], i: number) => (i >= 0 ? num(cells[i]) : null);
      for (const { cells, line } of queueT.rows) {
        const abs = wallClock(cells[qc.start]);
        if (isNaN(abs)) { bad.push(line); continue; }
        rawQueue.push({ abs, cq: at(cells, qc.cq), sl: at(cells, qc.sl), asa: at(cells, qc.asa), ab: at(cells, qc.ab) });
      }
      if (bad.length) warnings.push(`${SHEETS.queue}: skipped rows ${capped(bad.map(String))} (unreadable interval start).`);
      if (qc.cq < 0 || rawQueue.every(q => q.cq === null)) warnings.push(`${SHEETS.queue}: no "Calls Waiting" values, so the Queue backlog rule cannot fire.`);
    }
  }

  if (errors.length) return { ok: false, errors };

  // ---------- Timeline ----------
  const allAbs = [...raw.map(e => e.abs), ...rawHolds.map(h => h.abs), ...rawQueue.map(q => q.abs)];
  const first = Math.min(...raw.map(e => e.abs));
  // Bare times ("08:00:00") have no date, so they are already seconds since midnight.
  const midnight = Math.floor(first / 86400) * 86400;
  const rel = (abs: number) => Math.max(0, Math.round(abs - midnight));
  if (Math.max(...allAbs) - midnight > 36 * 3600) return { ok: false, errors: ["The file spans more than one day. Import one shift at a time."] };

  const teamOf = new Map(roster.map(a => [a.name, a.team]));
  const events: ReplayEvent[] = raw
    .map((e, i) => ({ e, i })).sort((a, b) => a.e.abs - b.e.abs || a.i - b.i)
    .map(({ e }) => ({ agent: e.agent, state: e.state, abs: e.abs, t: rel(e.abs), team: teamOf.get(e.agent) ?? "", transferred: e.transferred || undefined }));
  const holds = rawHolds.map(h => ({ agent: h.agent, t: rel(h.abs), on: h.on })).sort((a, b) => a.t - b.t);
  // Percent columns may hold 0–100 values or 0–1 fractions (as Genesys exports them).
  const pct = (key: "sl" | "ab") => { const fraction = rawQueue.every(q => (q[key] ?? 0) <= 1); return (v: number | null, fallback: number) => (v === null ? fallback : fraction ? v * 100 : v); };
  const sl = pct("sl"), ab = pct("ab");
  const queue: QueuePoint[] = rawQueue.sort((a, b) => a.abs - b.abs).map(q => ({ t: rel(q.abs), queue: { cq: q.cq ?? 0, sl: sl(q.sl, 100), asa: Math.round(q.asa ?? 0), ab: ab(q.ab, 0) } }));

  const silent = roster.filter(a => !raw.some(e => e.agent === a.name)).map(a => a.name);
  if (silent.length) warnings.push(`${silent.length} agent(s) have no status rows and stay Offline: ${capped(silent)}.`);
  for (const [status, state] of guessed) warnings.push(`Status "${status}" is not a console state; treated as ${STATES[state].label}.`);
  if (!queue.length) warnings.push("No queue intervals, so the queue tiles stay empty and queue rules are off.");

  return {
    ok: true, warnings,
    data: { org: [...teams.values()], roster, events, holds, queue },
    summary: { agents: roster.length, teams: teams.size, events: events.length, holds: holds.length / 2, queueIntervals: queue.length, startT: events[0].t, endT: events[events.length - 1].t },
  };
}
