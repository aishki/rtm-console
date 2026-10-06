import type { AgentState } from "@/lib/types";
import { clock } from "@/lib/engine/format";

export type MappedState = AgentState | "ignore";
export interface CsvCols { agent: number; status: number; start: number; team: number }
export interface ReplayEvent { agent: string; state: AgentState; team: string; abs: number; t: number }

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], f = "", inQ = false;
  const endRow = () => { row.push(f); f = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else inQ = false; } else f += c; }
    else if (c === '"') inQ = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; endRow(); }
    else f += c;
  }
  if (f !== "" || row.length) endRow();
  return rows;
}

/** Best guess of the console state for a Gencloud status or presence name. */
export function guessState(status: string): AgentState {
  const s = status.toLowerCase();
  if (/outbound/.test(s)) return "outb";
  if (/(on queue|interact|communicat|on call|talking|inbound)/.test(s)) return "oncall";
  if (/(acw|after.?call|wrap)/.test(s)) return "acw";
  if (/(break|meal|lunch)/.test(s)) return "auxb";
  if (/(available|idle|ready)/.test(s)) return "avail";
  if (/(offline|logged|logout)/.test(s)) return "off";
  return "auxp";
}

export function guessCols(h: string[]): CsvCols {
  const g = (ps: RegExp[]) => { for (const p of ps) { const i = h.findIndex(x => p.test(x.toLowerCase())); if (i >= 0) return i; } return -1; };
  const a = g([/agent.?name/, /user.?name/, /^agent$/, /^user$/, /^name$/, /employee/]);
  const s = g([/presence/, /^status$/, /routing.?status/, /status.?name/, /state/]);
  const t = g([/start/, /time.?stamp/, /^date/, /^time$/, /interval/]);
  const m = g([/team/, /group/, /queue/, /division/, /lob/]);
  return { agent: a >= 0 ? a : 0, status: s >= 0 ? s : Math.min(1, h.length - 1), start: t >= 0 ? t : Math.min(2, h.length - 1), team: m };
}

/** Split parsed CSV into trimmed headers and non-empty data rows. */
export function splitTable(all: string[][]): { headers: string[]; rows: string[][] } {
  return {
    headers: (all[0] ?? []).map(h => h.trim()),
    rows: all.slice(1).filter(r => r.length >= 2 && r.some(x => x && x.trim() !== "")),
  };
}

/** Distinct values of the status column, in file order (the mapping UI lists the first 40). */
export function distinctStatuses(rows: string[][], statusCol: number, cap = 40): string[] {
  const set = new Set<string>();
  for (const r of rows) { const v = (r[statusCol] || "").trim(); if (v) set.add(v); }
  return [...set].slice(0, cap);
}

function parseWhen(raw: string | undefined): number {
  if (!raw) return NaN;
  const v = raw.trim();
  let d = new Date(v);
  if (!isNaN(d.getTime())) return d.getTime() / 1000;
  d = new Date(v.replace(" ", "T"));
  if (!isNaN(d.getTime())) return d.getTime() / 1000;
  const m = v.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return +m[1] * 3600 + +m[2] * 60 + +(m[3] || 0) + 4102444800;
  return NaN;
}

/** Turn status rows into a time-ordered event list, `t` being seconds since that day's midnight. */
export function buildEvents(rows: string[][], cols: CsvCols, smap: Record<string, MappedState>): { events: ReplayEvent[] } | { error: string } {
  const ev: ReplayEvent[] = [];
  let bad = 0;
  for (const r of rows) {
    const agent = (r[cols.agent] || "").trim(), status = (r[cols.status] || "").trim(), abs = parseWhen(r[cols.start]);
    if (!agent || !status || isNaN(abs)) { bad++; continue; }
    const state = smap[status] || guessState(status);
    if (state === "ignore") continue;
    ev.push({ agent, state, abs, team: cols.team >= 0 ? (r[cols.team] || "").trim() : "", t: 0 });
  }
  if (ev.length < 2) return { error: `Could not build a timeline: ${bad} unreadable rows. Check the Start time column mapping (ISO dates, locale dates or HH:MM:SS all work).` };
  ev.sort((a, b) => a.abs - b.abs);
  const d0 = new Date(ev[0].abs * 1000);
  d0.setHours(0, 0, 0, 0);
  for (const e of ev) e.t = Math.max(0, Math.round(e.abs - d0.getTime() / 1000));
  return { events: ev };
}

export function sampleCsv(rnd: () => number = Math.random): string {
  const states = ["Available", "On Queue", "After Call Work", "Break", "Meal", "Away", "Meeting", "Outbound", "Offline"];
  const agents = [["Amara Reyes", "Team Alpha"], ["Joshua Lim", "Team Alpha"], ["Bea Santos", "Team Alpha"], ["Miguel Cruz", "Team Bravo"], ["Katrina Uy", "Team Bravo"], ["Paolo Dizon", "Team Bravo"]];
  let out = "Agent Name,Presence,Start Time,Team\n";
  for (const [nm, tm] of agents) {
    let t = 8 * 3600 + Math.floor(rnd() * 600);
    out += `${nm},Available,2026-08-17 ${clock(t)},${tm}\n`;
    for (let k = 0; k < 26; k++) {
      t += 120 + Math.floor(rnd() * 900);
      if (t > 17 * 3600) break;
      let st = states[Math.floor(rnd() * states.length)];
      if (nm === "Bea Santos" && rnd() < 0.5) st = rnd() < 0.5 ? "After Call Work" : "Away";
      out += `${nm},${st},2026-08-17 ${clock(t)},${tm}\n`;
    }
    out += `${nm},Offline,2026-08-17 ${clock(17 * 3600 + 300)},${tm}\n`;
  }
  return out;
}
