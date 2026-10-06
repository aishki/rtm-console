import ExcelJS from "exceljs";
import { defaultRules } from "@/lib/engine/rules";
import { type Cell, COLUMNS, SHEETS, STATUS_LABELS, type Sheet } from "./floor";

// Server-side spreadsheet I/O for the floor data import: reads an uploaded workbook into
// plain rows, and writes the template users download, fill in and upload.

export const TEMPLATE_FILENAME = "RTM_floor_data_template.xlsx";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function plain(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown; error?: unknown };
    if (o.error !== undefined) return null;
    if (o.result !== undefined) return plain(o.result); // formula
    if (o.richText) return o.richText.map(r => r.text).join("");
    if (o.text !== undefined) return plain(o.text); // hyperlink
  }
  return null;
}

/** Every worksheet as rows of plain cell values, keyed by sheet name. */
export async function readSheets(data: ArrayBuffer): Promise<Record<string, Sheet>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const out: Record<string, Sheet> = {};
  wb.eachSheet(ws => {
    const rows: Sheet = [];
    ws.eachRow({ includeEmpty: true }, row => {
      const values = row.values as unknown[]; // 1-based
      const cells: Cell[] = [];
      for (let i = 1; i < values.length; i++) cells.push(plain(values[i]));
      rows.push(cells);
    });
    out[ws.name] = rows;
  });
  return out;
}

// ---------- template ----------

const PURPLE = "FF5009B5", TINT = "FFF3F2FF", MUTED = "FF5C5C6F";
const DATE_FMT = "yyyy-mm-dd hh:mm:ss";
const SAMPLE_DAY = [2026, 9, 1] as const; // 1 October 2026
/** A wall-clock time on the sample day, as the spreadsheet stores it. */
const at = (seconds: number) => new Date(Date.UTC(SAMPLE_DAY[0], SAMPLE_DAY[1], SAMPLE_DAY[2]) + seconds * 1000);
const hm = (h: number, m = 0, s = 0) => h * 3600 + m * 60 + s;

const SAMPLE_ROSTER: [string, string, string, string, string, number][] = [
  ["Amara Reyes", "Team Alpha", "Rina Velasco", "Ava Santiago", "PAP Intake", 97],
  ["Joshua Lim", "Team Alpha", "Rina Velasco", "Ava Santiago", "PAP Intake", 95],
  ["Bea Santos", "Team Alpha", "Rina Velasco", "Ava Santiago", "PAP Intake", 92],
  ["Miguel Cruz", "Team Alpha", "Rina Velasco", "Ava Santiago", "PAP Intake", 98],
  ["Katrina Uy", "Team Bravo", "Marco Tan", "Ava Santiago", "PAP Intake", 96],
  ["Paolo Dizon", "Team Bravo", "Marco Tan", "Ava Santiago", "PAP Intake", 94],
  ["Lara Mendoza", "Team Bravo", "Marco Tan", "Ava Santiago", "PAP Intake", 99],
  ["Chris Bautista", "Team Bravo", "Marco Tan", "Ava Santiago", "PAP Intake", 93],
];

type StatusRow = [agent: string, status: string, t: number, transferred: string];

/** A believable day for the sample agents, with enough repeat behaviour to climb the ladder. */
function sampleDay(): { statuses: StatusRow[]; holds: [string, number, number][] } {
  let seed = 20261001;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a));
  const statuses: StatusRow[] = [], holds: [string, number, number][] = [];
  SAMPLE_ROSTER.forEach(([name], i) => {
    let t = hm(8) + between(0, 240);
    const add = (status: string, transferred = false) => statuses.push([name, status, t, transferred ? "Y" : ""]);
    add("Available");
    let lunchDone = false, breaks = 0;
    while (t < hm(16, 40)) {
      t += between(20, 150);
      add("On Call");
      // Bea releases a few calls almost immediately; everyone else has normal talk time.
      const talk = name === "Bea Santos" && rnd() < 0.3 ? between(8, 25) : between(180, 620);
      if (name === "Lara Mendoza" && rnd() < 0.25) { const hs = t + between(40, 90); holds.push([name, hs, hs + between(130, 220)]); }
      else if (rnd() < 0.15) { const hs = t + between(30, 80); holds.push([name, hs, Math.min(t + talk - 5, hs + between(20, 70))]); }
      t += talk;
      // Paolo transfers more than most.
      add("ACW", rnd() < (name === "Paolo Dizon" ? 0.4 : 0.07));
      // Joshua lingers in after-call work several times a day.
      t += name === "Joshua Lim" && rnd() < 0.3 ? between(150, 260) : between(20, 95);
      if (!lunchDone && t > hm(12) + i * 420) {
        add("Aux Break"); t += name === "Chris Bautista" ? between(1000, 1200) : between(700, 880); lunchDone = true;
      } else if (breaks < 2 && rnd() < 0.08) {
        add(name === "Katrina Uy" ? "Aux Personal" : "Aux Break"); t += name === "Katrina Uy" ? between(330, 480) : between(240, 600); breaks++;
      }
      add("Available");
    }
    t = hm(17) + between(0, 300);
    add("Offline");
  });
  return { statuses: statuses.sort((a, b) => a[2] - b[2]), holds: holds.filter(h => h[2] > h[1]) };
}

function sampleQueue(): [number, number, number, number, number][] {
  // interval start, calls waiting, service level %, ASA seconds, abandon %
  const rows: [number, number, number, number, number][] = [];
  for (let t = hm(8), i = 0; t < hm(17); t += 1800, i++) {
    const busy = i >= 6 && i <= 7; // a rough late-morning hour
    rows.push([t, busy ? 11 + (i - 6) * 2 : 1 + (i % 4), busy ? 71 - (i - 6) * 3 : 90 + (i % 5), busy ? 64 + (i - 6) * 20 : 9 + (i % 6) * 3, busy ? 6.2 + (i - 6) : 0.6 + (i % 3) * 0.7]);
  }
  return rows;
}

function header(ws: ExcelJS.Worksheet, columns: readonly string[], widths: number[], required: number) {
  ws.columns = columns.map((c, i) => ({ header: c, width: widths[i] ?? 18 }));
  const row = ws.getRow(1);
  row.height = 22;
  row.eachCell((cell, col) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PURPLE } };
    cell.alignment = { vertical: "middle" };
    cell.note = col <= required ? "Required" : "Optional";
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

/** The workbook users fill in. It ships with a small sample day so it runs as downloaded. */
export async function buildTemplate(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RTM Console";
  const rule = (id: string) => defaultRules().find(r => r.id === id)!;

  // Instructions
  const info = wb.addWorksheet("Instructions");
  info.columns = [{ width: 24 }, { width: 22 }, { width: 12 }, { width: 92 }];
  const title = info.addRow(["RTM Console · floor data template"]);
  title.font = { bold: true, size: 16, color: { argb: PURPLE } };
  info.addRow([]);
  for (const line of [
    "1. Fill in the Roster and Agent Status sheets. Holds and Queue Intervals are optional.",
    "2. Keep the sheet names and the header row as they are. Column order does not matter.",
    "3. One file is one shift (one day). Times are taken exactly as written; there is no timezone conversion.",
    "4. Replace the sample rows with your own data. The sample runs as is if you want to try the import first.",
    "5. In RTM Console open Dashboards, choose Import floor data, and upload this file.",
  ]) info.addRow([line]);
  info.addRow([]);
  const head = info.addRow(["Sheet", "Column", "Required", "What to enter"]);
  head.eachCell(c => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PURPLE } }; });
  const guide: [string, string, string, string][] = [
    [SHEETS.roster, "Agent Name", "Yes", "One row per agent on shift. Names must be unique and must match the names used on the other sheets exactly."],
    ["", "Team", "Yes", "The agent's team. Each team has exactly one team lead and one manager."],
    ["", "Team Lead", "Yes", "Scopes the Team Lead view to this team."],
    ["", "Manager", "Yes", "Scopes the Manager view to every team under this manager."],
    ["", "LOB", "No", "Line of business, shown in the team filter. Defaults to the team name."],
    ["", "Adherence %", "No", "Shift adherence at the start of the day, 0 to 100. Defaults to 96. It then drifts with time spent in Aux Personal and Offline."],
    [SHEETS.status, "Agent Name", "Yes", "Must be an agent on the Roster sheet."],
    ["", "Status", "Yes", `The status the agent changed to: ${STATUS_LABELS.join(", ")}. Genesys names such as "On Queue", "After Call Work", "Meal" or "Break" are recognised too.`],
    ["", "Start Time", "Yes", "When that status began, as a date and time (2026-10-01 08:00:00). One row per status change; the status lasts until the agent's next row."],
    ["", "Transferred", "No", "Y on the row that ends a call (the first status after On Call) if that call was transferred. Feeds the Transfer rate rule."],
    [SHEETS.holds, "Agent Name / Hold Start / Hold End", "No", `One row per hold while the agent is On Call. Feeds the Long hold rule (default ${rule("hold").thr}s).`],
    [SHEETS.queue, "Interval Start", "Yes*", "*Required only if you use this sheet. Start of each interval; the values hold until the next row. Use the all-queues totals from a Genesys queue performance export."],
    ["", "Calls Waiting", "No", `Calls in queue. Feeds the Queue backlog rule (default above ${rule("cq").thr}). A Genesys interval export does not include this.`],
    ["", "Service Level %", "No", `0 to 100, or 0 to 1 as Genesys exports it. Feeds the Service level rule (default below ${rule("sl").thr}%).`],
    ["", "ASA (s)", "No", "Average speed of answer, in seconds."],
    ["", "Abandon %", "No", `0 to 100, or 0 to 1. Feeds the Abandon rate rule (default above ${rule("aband").thr}%).`],
  ];
  for (const g of guide) { const r = info.addRow(g); r.getCell(4).alignment = { wrapText: true, vertical: "top" }; if (g[0]) r.getCell(1).font = { bold: true }; }
  info.addRow([]);
  const note = info.addRow(["What each sheet unlocks: Roster + Agent Status drive the agent grid, My View, strikes, nudges and incidents. Holds adds Long hold. Queue Intervals adds the queue tiles and queue rules."]);
  note.font = { color: { argb: MUTED } };

  const { statuses, holds } = sampleDay();

  const roster = wb.addWorksheet(SHEETS.roster);
  header(roster, COLUMNS.roster, [24, 18, 22, 22, 20, 14], 4);
  SAMPLE_ROSTER.forEach(r => roster.addRow(r));

  const status = wb.addWorksheet(SHEETS.status);
  header(status, COLUMNS.status, [24, 18, 22, 14], 3);
  statuses.forEach(([agent, s, t, x]) => status.addRow([agent, s, at(t), x || null]));
  status.getColumn(3).numFmt = DATE_FMT;
  const dv = (status as unknown as { dataValidations: { add(range: string, v: ExcelJS.DataValidation): void } }).dataValidations;
  dv.add("B2:B20000", { type: "list", allowBlank: true, formulae: [`Lists!$A$2:$A$${STATUS_LABELS.length + 1}`], showErrorMessage: false });
  dv.add("D2:D20000", { type: "list", allowBlank: true, formulae: ['"Y,N"'], showErrorMessage: false });

  const holdWs = wb.addWorksheet(SHEETS.holds);
  header(holdWs, COLUMNS.holds, [24, 22, 22], 0);
  holds.sort((a, b) => a[1] - b[1]).forEach(([agent, a, b]) => holdWs.addRow([agent, at(a), at(b)]));
  holdWs.getColumn(2).numFmt = DATE_FMT;
  holdWs.getColumn(3).numFmt = DATE_FMT;

  const queue = wb.addWorksheet(SHEETS.queue);
  header(queue, COLUMNS.queue, [22, 14, 16, 10, 12], 0);
  sampleQueue().forEach(([t, ...rest]) => queue.addRow([at(t), ...rest]));
  queue.getColumn(1).numFmt = DATE_FMT;

  for (const ws of [roster, status, holdWs, queue]) ws.getRow(1).eachCell(c => { c.border = { bottom: { style: "thin", color: { argb: TINT } } }; });

  // Status names for the dropdown on the Agent Status sheet.
  const lists = wb.addWorksheet("Lists");
  lists.columns = [{ header: "Status", width: 20 }];
  STATUS_LABELS.forEach(s => lists.addRow([s]));
  lists.getRow(1).font = { bold: true };

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
