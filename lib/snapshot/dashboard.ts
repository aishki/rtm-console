import type { FeedKind, Incident, Instance, Role, View } from "@/lib/types";
import type { EngineState } from "@/lib/engine/escalation";
import { ROLE_LABEL } from "@/lib/engine/rules";
import { PERMS, scopeAgents, scopeIncidents, scopeLedger, scopeTeams } from "@/lib/engine/scope";
import { wallClock } from "@/lib/floorTime";

// The Dashboards screen saved as one self-contained HTML file: the viewer's scoped data is
// frozen inside it, and a small script redraws the tiles, charts and tables as the reader
// filters and sorts. It never calls the console, so nothing in it can change floor data.

export interface SnapshotTeam { team: string; tl: string; mgr: string; agents: number }
export type SnapshotCallout = Pick<Instance, "t" | "agent" | "team" | "rule" | "stage" | "ackT"> & { floor: boolean };
export type SnapshotIncident = Pick<Incident, "inc" | "t" | "agent" | "team" | "rule" | "instances" | "status" | "disposition" | "closedT">;

export interface DashboardSnapshot {
  /** When the snapshot was taken, as an ISO timestamp. */
  takenAt: string;
  /** Shift clock at that moment, seconds since midnight. */
  shiftT: number;
  viewer: string; role: string; span: string;
  /** Where the numbers came from, e.g. "Live Genesys". */
  source: string;
  /** Set when the activity is not real floor activity; shown as a banner. */
  notice: string;
  canExport: boolean;
  teams: SnapshotTeam[];
  ledger: SnapshotCallout[];
  incidents: SnapshotIncident[];
}

const SOURCE: Record<FeedKind, { label: string; notice: string }> = {
  gencloud: { label: "Live Genesys", notice: "" },
  sim: { label: "Simulation", notice: "Simulation: every state change, call-out and incident in this snapshot is invented." },
  csv: { label: "Data replay", notice: "Data replay: these results come from an imported file run through the rules engine, not from the live floor." },
};
const UNNAMED: Partial<Record<Role, string>> = { admin: "WFM Admin", senior: "Senior Leader" };

/** What the viewer's Dashboards screen shows right now, scoped to their span. */
export function snapshotData(S: EngineState, view: View, feed: FeedKind, now: Date): DashboardSnapshot {
  const perms = PERMS[view.role];
  const headcount = new Map<string, number>();
  for (const a of scopeAgents(S, view)) headcount.set(a.team, (headcount.get(a.team) ?? 0) + 1);
  return {
    takenAt: now.toISOString(), shiftT: S.t,
    viewer: view.who ?? UNNAMED[view.role] ?? "", role: ROLE_LABEL[view.role], span: perms.desc(view.who),
    source: SOURCE[feed].label, notice: SOURCE[feed].notice, canExport: perms.export,
    teams: scopeTeams(S, view).map(t => ({ team: t.team, tl: t.tl, mgr: t.mgr, agents: headcount.get(t.team) ?? 0 })),
    ledger: scopeLedger(S, view, S.ledger).map(r => ({ t: r.t, agent: r.agent, team: r.team, rule: r.rule, stage: r.stage, ackT: r.ackT, floor: r.isFloor })),
    incidents: scopeIncidents(S, view, S.incidents).map(i => ({
      inc: i.inc, t: i.t, agent: i.agent, team: i.team, rule: i.rule, instances: i.instances, status: i.status, disposition: i.disposition, closedT: i.closedT,
    })),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** File name for a snapshot taken at `now` (floor time, US Eastern), e.g. RTM_dashboard_snapshot_2026-10-07_1432.html. */
export const snapshotFileName = (now: Date): string => {
  const w = wallClock(now);
  return `RTM_dashboard_snapshot_${w.year}-${pad(w.month)}-${pad(w.day)}_${pad(w.hour)}${pad(w.minute)}.html`;
};

/** JSON that is safe inside a <script> element: no "<" to close the tag, no raw line separators. */
const embed = (data: unknown): string =>
  JSON.stringify(data).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, c => (c === "\u2028" ? "\\u2028" : "\\u2029"));

/** The whole snapshot page. Everything it needs is inline, so it opens from a file with no network. */
export function dashboardHtml(data: DashboardSnapshot): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>RTM Console · Shift dashboards snapshot</title>
<style>${CSS}</style>
</head>
<body>
${BODY}
<script id="rtm-data" type="application/json">${embed(data)}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

// Colors and shapes follow the BITS tokens in app/globals.css and lib/ui/palette.ts.
const CSS = String.raw`
:root{--purple:#5009B5;--purple-hover:#3E0790;--purple-900:#280559;--purple-600:#6F1DF4;--tint:#F3F2FF;--primary-300:#E6D9FE;--pale-purple:#EBE4FF;
--ink:#231E33;--strong:#303044;--muted:#5C5C6F;--subtle:#828294;--page:#F5F5F5;--line:#CBD2DC;--row:#F1F1F1;--hairline:rgba(0,0,0,.12);
--warning-text:#7A5300;--warning-tint:#FDF3D7;--error-text:#B00830;--error-tint:#FBE3E8;--success-text:#2F6E29;--success-tint:#E5F2E3;--turquoise-text:#028283;--focus:#0C7DB6;
--ui:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
*{box-sizing:border-box}
[hidden]{display:none!important}
html,body{margin:0;background:var(--page)}
body{font-family:"Elevance Sans",var(--ui);font-size:14px;color:var(--ink)}
button,select,input{font-family:inherit}
button:not(:disabled),select,label{cursor:pointer}
button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.num{font-family:var(--ui);font-variant-numeric:tabular-nums}
.top{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;background:#fff;padding:14px 32px;box-shadow:inset 0 -1px 0 var(--hairline)}
.brand{display:flex;flex-direction:column;gap:2px}
.brand b{font-size:18px;font-weight:600;color:var(--purple);letter-spacing:-.01em}
.brand span{font-size:12px;color:var(--muted)}
.grow{flex:1}
.pill{display:inline-block;font-size:12px;font-weight:600;border-radius:108px;padding:2px 10px;white-space:nowrap}
.badge{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 14px;border-radius:108px;font-size:13px;font-weight:600;background:var(--pale-purple);color:var(--purple)}
.badge i{width:8px;height:8px;border-radius:50%;background:currentColor}
main{display:flex;flex-direction:column;gap:24px;max-width:1600px;margin:0 auto;padding:28px 32px 40px}
.eyebrow{font-size:16px;font-weight:500;color:var(--muted)}
h1{margin:6px 0 0;font-size:36px;font-weight:500;line-height:1.15;letter-spacing:-.02em;color:var(--purple)}
.meta{margin:10px 0 0;font-size:13px;color:var(--muted);line-height:1.5}
.meta b{font-weight:600;color:var(--strong)}
.notice{border-radius:16px;background:var(--warning-tint);color:var(--warning-text);padding:12px 18px;font-size:13px;font-weight:600}
.panel{background:#fff;border-radius:20px;box-shadow:inset 0 0 0 1px var(--pale-purple);overflow:hidden}
.panel-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 20px;min-height:38px;border-bottom:1px solid var(--pale-purple)}
.panel-title{margin:0;font-size:20px;font-weight:500;color:var(--purple);letter-spacing:-.01em}
.panel-sub{font-size:13px;color:var(--muted)}
.slicers{display:flex;flex-wrap:wrap;align-items:flex-end;gap:14px 16px;padding:16px 20px}
.slicer{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:600;color:var(--muted)}
.field{height:36px;min-width:170px;max-width:260px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);font-size:14px;padding:0 10px}
.chips{display:flex;gap:6px}
.chip{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px;border-radius:108px;border:1px solid var(--line);background:#fff;color:var(--muted);font-size:13px;font-weight:600}
.chip i{width:10px;height:10px;border-radius:3px;opacity:.35}
.chip[aria-pressed=true]{border-color:var(--purple);background:var(--tint);color:var(--purple-900)}
.chip[aria-pressed=true] i{opacity:1}
.btn{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 15px;border:0;border-radius:20px;background:#fff;color:var(--purple);font-size:14px;font-weight:600;white-space:nowrap;box-shadow:inset 0 0 0 1px var(--purple)}
.btn:hover:not(:disabled){background:var(--tint)}
.btn:active:not(:disabled){background:var(--primary-300)}
.btn:disabled{opacity:.4;cursor:not-allowed}
.count{align-self:center;font-size:13px;color:var(--muted)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:16px}
.kpi{display:flex;flex-direction:column;gap:6px;border-radius:16px;background:#fff;padding:16px 18px}
.kpi-label{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;color:var(--muted)}
.kpi-label i{width:8px;height:8px;border-radius:50%}
.kpi-value{font-size:30px;font-weight:600;line-height:1.1;letter-spacing:-.02em}
.kpi-sub{font-size:12px;color:var(--muted)}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr));gap:24px}
.charts .panel{display:flex;flex-direction:column}
.charts .bars{flex:1}
.bars{display:flex;flex-direction:column;gap:2px;padding:10px 12px}
.bar{display:grid;grid-template-columns:150px minmax(0,1fr) 36px;align-items:center;gap:12px;width:100%;padding:5px 8px;border:0;border-radius:8px;background:none;color:inherit;font-size:13px;text-align:left}
.bar.people{grid-template-columns:190px minmax(0,1fr) 36px}
.bar:hover{background:var(--tint)}
.bar[aria-pressed=true]{background:var(--pale-purple)}
.bar-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--strong)}
.who,.dom{display:block;overflow:hidden;text-overflow:ellipsis}
.dom{font-size:11px;font-weight:400;color:var(--muted)}
.track{display:flex;height:14px;overflow:hidden;border-radius:4px;background:var(--page)}
.track span{height:100%}
.bar-total{text-align:right;font-weight:600}
.legend{display:flex;flex-wrap:wrap;align-items:center;gap:16px;padding:4px 20px 18px;font-size:12px;color:var(--muted)}
.legend span{display:inline-flex;align-items:center;gap:6px}
.legend i{width:10px;height:10px;border-radius:3px}
.empty{padding:32px 20px;text-align:center;color:var(--muted)}
.seg{display:inline-flex;border-radius:108px;box-shadow:inset 0 0 0 1px var(--line);overflow:hidden}
.seg button{height:32px;padding:0 12px;border:0;background:none;color:var(--muted);font-size:13px;font-weight:600}
.seg button[aria-pressed=true]{background:var(--purple);color:#fff}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}
th{background:var(--tint);box-shadow:inset 0 -1px 0 var(--primary-300);font-family:var(--ui);font-size:12px;font-weight:600;color:var(--purple-900);white-space:nowrap;text-align:left;padding:0}
th button{display:inline-flex;align-items:center;gap:6px;width:100%;padding:10px 14px;border:0;background:none;color:inherit;font:inherit;text-align:inherit}
th button:hover{color:var(--purple)}
th.r button{justify-content:flex-end}
th .arrow{width:8px;font-size:10px}
td{padding:11px 14px;border-bottom:1px solid var(--row)}
th:first-child button,td:first-child{padding-left:20px}
th:last-child button,td:last-child{padding-right:20px}
td.r{text-align:right}
td.b{font-weight:600}
td.nw{white-space:nowrap}
td.m{color:var(--muted)}
td.id{font-family:var(--ui);font-weight:600;color:var(--purple);white-space:nowrap}
tr.pick{cursor:pointer}
tr.pick:hover td{background:var(--tint)}
tr.on td{background:var(--pale-purple)}
.t-nudge{color:var(--turquoise-text)}.t-lead{color:var(--warning-text)}.t-ops{color:var(--purple)}.t-ir{color:var(--error-text)}
.zero{color:var(--subtle)}
footer{padding:0 32px 32px;text-align:center;font-size:12px;color:var(--muted)}
@media (max-width:640px){.top{padding:12px 16px}main{padding:20px 16px 32px}h1{font-size:28px}.field{min-width:140px}.bar{grid-template-columns:110px minmax(0,1fr) 32px}.bar.people{grid-template-columns:130px minmax(0,1fr) 32px}}
@media print{.slicers .btn,.panel-head .btn{display:none}.panel{break-inside:avoid}}
`;

const BODY = String.raw`<header class="top">
  <div class="brand"><b>RTM Console</b><span>Real-Time Monitoring &amp; Escalation</span></div>
  <div class="grow"></div>
  <span class="badge" id="source"><i></i><span></span></span>
  <span class="badge">Read-only snapshot</span>
</header>
<main>
  <div>
    <span class="eyebrow">Review · saved snapshot</span>
    <h1>Shift dashboards</h1>
    <p class="meta" id="meta"></p>
  </div>
  <div class="notice" id="notice" hidden></div>
  <section class="panel slicers" aria-label="Filters">
    <label class="slicer" id="mgr-slicer">Manager<select class="field" id="f-mgr"></select></label>
    <label class="slicer" id="team-slicer">Team<select class="field" id="f-team"></select></label>
    <label class="slicer">Rule<select class="field" id="f-rule"></select></label>
    <label class="slicer">Agent<input class="field" id="f-agent" type="search" placeholder="Search by name" autocomplete="off"></label>
    <div class="slicer">Stage<div class="chips" id="f-stages"></div></div>
    <div class="grow"></div>
    <span class="count" id="count" aria-live="polite"></span>
    <button type="button" class="btn" id="clear" data-act="clear">Clear filters</button>
    <button type="button" class="btn" data-act="print">Print</button>
  </section>
  <div class="kpis" id="kpis"></div>
  <div class="charts">
    <div class="panel" id="by-rule"></div>
    <div class="panel" id="by-agent"></div>
  </div>
  <div class="panel">
    <div class="panel-head">
      <h2 class="panel-title">Repeat offenders · investigation register</h2>
      <span class="panel-sub" id="inc-sub"></span>
      <div class="grow"></div>
      <div class="seg" id="f-status" role="group" aria-label="Incident status"></div>
      <button type="button" class="btn" id="export" data-act="export" hidden>Export incidents CSV</button>
    </div>
    <div class="scroll" id="incidents"></div>
  </div>
  <div class="panel">
    <div class="panel-head">
      <h2 class="panel-title">Breakdown by team</h2>
      <span class="panel-sub">Instances by stage, incidents and top cause. Select a row to filter by that team.</span>
    </div>
    <div class="scroll" id="teams"></div>
  </div>
</main>
<footer>A frozen copy of the Dashboards screen. Filters and sorting only change what this file shows; nothing here is sent back to the RTM Console.</footer>`;

// Plain ES5-style script with no template literals, so it can sit in a raw string untouched.
const SCRIPT = String.raw`
(function () {
  "use strict";
  var D = JSON.parse(document.getElementById("rtm-data").textContent);
  var STAGES = [["nudge", "Nudge", "#00BBBA"], ["lead", "Leader", "#F2BC35"], ["ops", "Ops", "#5009B5"]];
  var STATUSES = ["", "Open", "Investigating", "Closed"];
  var INC_TONE = { Open: ["#FBE3E8", "#B00830"], Investigating: ["#FDF3D7", "#7A5300"], Closed: ["#E5F2E3", "#2F6E29"] };
  var LEVEL = { ok: ["#231E33", "#449E3C"], warn: ["#7A5300", "#F2BC35"], crit: ["#B00830", "#D20A36"], esc: ["#5009B5", "#5009B5"] };
  var F = fresh();
  var sorts = { incidents: { key: "", dir: 1 }, teams: { key: "", dir: 1 } };
  var shownIncidents = [];

  function fresh() { return { mgr: "", team: "", rule: "", agent: "", status: "", stages: { nudge: true, lead: true, ops: true } }; }
  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function clock(t) { return pad(Math.floor(t / 3600)) + ":" + pad(Math.floor((t % 3600) / 60)) + ":" + pad(t % 60); }
  function uniq(list) { var seen = {}, out = []; list.forEach(function (v) { if (v && !seen["$" + v]) { seen["$" + v] = 1; out.push(v); } }); return out.sort(function (a, b) { return a.localeCompare(b); }); }
  function options(all, values, current) {
    return '<option value="">' + esc(all) + "</option>" + values.map(function (v) { return '<option value="' + esc(v) + '"' + (v === current ? " selected" : "") + ">" + esc(v) + "</option>"; }).join("");
  }
  function isFiltered() { return !!(F.mgr || F.team || F.rule || F.agent || F.status || !(F.stages.nudge && F.stages.lead && F.stages.ops)); }

  // ---------- filtering ----------
  function teamsInView() { return D.teams.filter(function (t) { return (!F.mgr || t.mgr === F.mgr) && (!F.team || t.team === F.team); }); }
  function scope() {
    var teams = teamsInView(), names = {}, byTeam = !!(F.mgr || F.team), q = F.agent.trim().toLowerCase();
    teams.forEach(function (t) { names["$" + t.team] = 1; });
    function who(r, floor) {
      if (byTeam && (floor || !names["$" + r.team])) return false;
      if (F.rule && r.rule !== F.rule) return false;
      return !q || (!floor && r.agent.toLowerCase().indexOf(q) >= 0);
    }
    return {
      teams: teams,
      ledger: D.ledger.filter(function (r) { return F.stages[r.stage] && who(r, r.floor); }),
      incidents: D.incidents.filter(function (i) { return who(i, false); })
    };
  }
  function tally(rows, key, cap) {
    var m = {}, out = [];
    rows.forEach(function (r) {
      var k = key(r), c = m["$" + k];
      if (!c) { c = m["$" + k] = { label: k, nudge: 0, lead: 0, ops: 0, total: 0 }; out.push(c); }
      c[r.stage]++; c.total++;
    });
    out.sort(function (a, b) { return b.total - a.total; });
    return cap ? out.slice(0, cap) : out;
  }
  function avgResponse(rows) {
    var sum = 0, n = 0;
    rows.forEach(function (r) { if (r.ackT !== null) { sum += r.ackT - r.t; n++; } });
    return n ? Math.round(sum / n) + "s" : "—";
  }

  // ---------- drawing ----------
  function kpi(label, value, sub, level) {
    var c = LEVEL[level];
    return '<div class="kpi"><div class="kpi-label"><i style="background:' + c[1] + '"></i>' + esc(label) + '</div><span class="kpi-value num" style="color:' + c[0] + '">' + esc(value) + '</span><span class="kpi-sub">' + esc(sub) + "</span></div>";
  }
  function chart(title, sub, bars, act, picked, note) {
    var max = Math.max.apply(null, [1].concat(bars.map(function (b) { return b.total; })));
    var rows = bars.map(function (b) {
      var track = STAGES.map(function (s) { return '<span style="width:' + (b[s[0]] / max) * 100 + "%;background:" + s[2] + '"></span>'; }).join("");
      return '<button type="button" class="bar' + (act === "agent" ? " people" : "") + '" data-act="' + act + '" data-value="' + esc(b.label) + '" aria-pressed="' + (picked === b.label) + '" title="Filter by ' + esc(b.label) + '">' +
        '<span class="bar-label">' + (act === "agent" ? person(b.label) : esc(b.label)) + '</span><span class="track" role="img" aria-label="' + b.nudge + " nudge, " + b.lead + " leader, " + b.ops + ' ops">' + track + '</span><span class="bar-total num">' + b.total + "</span></button>";
    }).join("");
    var legend = STAGES.map(function (s) { return '<span><i style="background:' + s[2] + '"></i>' + s[1] + "</span>"; }).join("");
    return '<div class="panel-head"><h2 class="panel-title">' + esc(title) + '</h2><span class="panel-sub">' + esc(sub) + "</span></div>" +
      (bars.length ? '<div class="bars">' + rows + "</div>" : '<div class="empty">No call-outs match these filters.</div>') +
      '<div class="legend">' + legend + (note ? "<span>" + esc(note) + "</span>" : "") + "</div>";
  }
  /** cols: [key, header, sort value, cell html, cell class, header class] */
  function table(id, cols, rows, empty, pick) {
    var s = sorts[id];
    if (s.key) {
      var col = cols.filter(function (c) { return c[0] === s.key; })[0];
      rows = rows.slice().sort(function (a, b) {
        var x = col[2](a), y = col[2](b);
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * s.dir;
      });
    }
    var head = cols.map(function (c) {
      var on = s.key === c[0], right = (c[4] || "").indexOf("r") === 0;
      return '<th scope="col" class="' + (right ? "r " : "") + (c[5] || "") + '"' + (on ? ' aria-sort="' + (s.dir > 0 ? "ascending" : "descending") + '"' : "") + '><button type="button" data-act="sort" data-table="' + id + '" data-value="' + c[0] + '" title="Sort by ' + esc(c[1]) + '">' +
        esc(c[1]) + '<span class="arrow" aria-hidden="true">' + (on ? (s.dir > 0 ? "▲" : "▼") : "") + "</span></button></th>";
    }).join("");
    var body = rows.map(function (r) {
      var attrs = pick ? ' class="pick' + (pick.on(r) ? " on" : "") + '" data-act="' + pick.act + '" data-value="' + esc(pick.value(r)) + '" tabindex="0"' : "";
      return "<tr" + attrs + ">" + cols.map(function (c) { return '<td class="' + (c[4] || "") + '">' + c[3](r) + "</td>"; }).join("") + "</tr>";
    }).join("");
    $(id).innerHTML = "<table><thead><tr>" + head + "</tr></thead><tbody>" + body + "</tbody></table>" + (rows.length ? "" : '<div class="empty">' + esc(empty) + "</div>");
    return rows;
  }
  function text(get) { return function (r) { return esc(get(r)); }; }
  /** "Last, First - AH12345" as the name with the domain ID under it. The last " - " separates them: a surname can hold one too. */
  function person(n) {
    var c = n.lastIndexOf(" - ");
    return c < 0 ? esc(n) : '<span class="who">' + esc(n.slice(0, c)) + '</span><span class="dom num">' + esc(n.slice(c + 3)) + "</span>";
  }
  function count(get, cls) { return function (r) { var n = get(r); return '<span class="' + (n ? cls || "" : "zero") + '">' + n + "</span>"; }; }

  function render() {
    var S = scope(), L = S.ledger;
    var by = function (stage) { return L.filter(function (r) { return r.stage === stage; }).length; };
    var open = S.incidents.filter(function (i) { return i.status !== "Closed"; }).length;
    $("kpis").innerHTML =
      kpi("Call-outs (shift)", L.length, isFiltered() ? "Matching the filters" : "All stages · snapshot span", "ok") +
      kpi("Nudges", by("nudge"), "Agent self-corrections", "ok") +
      kpi("Leader alerts", by("lead"), "Needed intervention", by("lead") > 8 ? "warn" : "ok") +
      kpi("Ops escalations", by("ops"), "3× rule", by("ops") > 0 ? "esc" : "ok") +
      kpi("Open investigations", open, S.incidents.length + " incidents in span", open > 0 ? "crit" : "ok") +
      kpi("Avg leader response", avgResponse(L), "Time to acknowledge", "ok");

    var people = L.filter(function (r) { return !r.floor; });
    $("by-rule").innerHTML = chart("Call-out summary by rule", "By escalation stage. Select a bar to filter.", tally(L, function (r) { return r.rule; }), "rule", F.rule);
    $("by-agent").innerHTML = chart("Call-out summary by top agents", "Instances per agent. Select a bar to filter.", tally(people, function (r) { return r.agent; }, 8), "agent", F.agent, "Agents at ×3 open an investigation below.");

    var register = F.status ? S.incidents.filter(function (i) { return i.status === F.status; }) : S.incidents;
    $("inc-sub").textContent = open + " open · " + (S.incidents.length - open) + " closed";
    shownIncidents = table("incidents", [
      ["inc", "Incident #", function (i) { return i.inc; }, text(function (i) { return i.inc; }), "id"],
      ["t", "Opened", function (i) { return i.t; }, function (i) { return clock(i.t); }, "num"],
      ["agent", "Agent", function (i) { return i.agent; }, function (i) { return person(i.agent); }, "b nw"],
      ["team", "Team", function (i) { return i.team; }, text(function (i) { return i.team; }), "m nw"],
      ["rule", "Trigger rule", function (i) { return i.rule; }, text(function (i) { return i.rule; }), "nw"],
      ["instances", "Instances", function (i) { return i.instances; }, function (i) { return "×" + i.instances; }, "num b"],
      ["status", "Status", function (i) { return STATUSES.indexOf(i.status); }, function (i) { var c = INC_TONE[i.status] || ["#F5F5F5", "#5C5C6F"]; return '<span class="pill" style="background:' + c[0] + ";color:" + c[1] + '">' + esc(i.status) + "</span>"; }],
      ["disposition", "Disposition", function (i) { return i.disposition || ""; }, text(function (i) { return i.disposition || "—"; }), "m"],
      ["closedT", "Closed", function (i) { return i.closedT === null ? -1 : i.closedT; }, function (i) { return i.closedT === null ? "—" : clock(i.closedT); }, "num m"]
    ], register, S.incidents.length ? "No incidents have this status." : "No agents meet the investigation threshold (3 instances of the same rule in one shift) under these filters.");

    table("teams", [
      ["team", "Team", function (t) { return t.team; }, text(function (t) { return t.team; }), "b"],
      ["tl", "Team Lead", function (t) { return t.tl; }, text(function (t) { return t.tl; })],
      ["mgr", "Manager", function (t) { return t.mgr; }, text(function (t) { return t.mgr; }), "m"],
      ["agents", "Agents", function (t) { return t.agents; }, function (t) { return t.agents; }, "r num"],
      ["n", "Nudges", function (t) { return t.n; }, count(function (t) { return t.n; }), "r num b", "t-nudge"],
      ["l", "Leader", function (t) { return t.l; }, count(function (t) { return t.l; }), "r num b", "t-lead"],
      ["o", "Ops", function (t) { return t.o; }, count(function (t) { return t.o; }), "r num b", "t-ops"],
      ["ir", "Open IR", function (t) { return t.ir; }, count(function (t) { return t.ir; }, "t-ir"), "r num b", "t-ir"],
      ["top", "Top cause", function (t) { return t.top; }, text(function (t) { return t.top; })]
    ], S.teams.map(function (t) {
      var rows = people.filter(function (r) { return r.team === t.team; }), top = tally(rows, function (r) { return r.rule; }, 1)[0];
      var n = function (stage) { return rows.filter(function (r) { return r.stage === stage; }).length; };
      return {
        team: t.team, tl: t.tl, mgr: t.mgr, agents: t.agents, n: n("nudge"), l: n("lead"), o: n("ops"),
        ir: S.incidents.filter(function (i) { return i.team === t.team && i.status !== "Closed"; }).length, top: top ? top.label + " ×" + top.total : "—"
      };
    }), "No teams match these filters.", { act: "team", value: function (t) { return t.team; }, on: function (t) { return F.team === t.team; } });

    sync(L.length);
  }

  /** Bring the filter controls in line with F (they are also changed by picking bars and rows). */
  function sync(shown) {
    var managed = F.mgr ? D.teams.filter(function (t) { return t.mgr === F.mgr; }) : D.teams;
    $("f-mgr").value = F.mgr;
    $("f-team").innerHTML = options("All teams", uniq(managed.map(function (t) { return t.team; })), F.team);
    $("f-rule").value = F.rule;
    if ($("f-agent").value !== F.agent) $("f-agent").value = F.agent;
    $("f-stages").innerHTML = STAGES.map(function (s) { return '<button type="button" class="chip" data-act="stage" data-value="' + s[0] + '" aria-pressed="' + F.stages[s[0]] + '"><i style="background:' + s[2] + '"></i>' + s[1] + "</button>"; }).join("");
    $("f-status").innerHTML = STATUSES.map(function (s) { return '<button type="button" data-act="status" data-value="' + s + '" aria-pressed="' + (F.status === s) + '">' + (s || "All") + "</button>"; }).join("");
    $("count").textContent = isFiltered() ? "Showing " + shown + " of " + D.ledger.length + " call-outs" : D.ledger.length + " call-outs";
    $("clear").disabled = !isFiltered();
  }

  function exportIncidents() {
    var q = function (s) { return '"' + String(s).replace(/"/g, '""') + '"'; };
    var lines = shownIncidents.map(function (i) {
      return [i.inc, clock(i.t), q(i.agent), q(i.team), q(i.rule), i.instances, i.status, q(i.disposition || ""), i.closedT !== null ? clock(i.closedT) : ""].join(",");
    });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["incident,opened,agent,team,rule,instances,status,disposition,closed\n" + lines.join("\n")], { type: "text/csv" }));
    a.download = "RTM_investigation_register.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
  }

  function act(el) {
    var a = el.getAttribute("data-act"), v = el.getAttribute("data-value");
    if (a === "clear") F = fresh();
    else if (a === "print") return window.print();
    else if (a === "export") return exportIncidents();
    else if (a === "stage") F.stages[v] = !F.stages[v];
    else if (a === "status") F.status = v;
    else if (a === "rule") F.rule = F.rule === v ? "" : v;
    else if (a === "agent") F.agent = F.agent === v ? "" : v;
    else if (a === "team") F.team = F.team === v ? "" : v;
    else if (a === "sort") { var s = sorts[el.getAttribute("data-table")]; s.dir = s.key === v ? -s.dir : 1; s.key = v; }
    render();
    // The control that was used has just been redrawn: put keyboard focus back on it.
    var again = [].filter.call(document.querySelectorAll('[data-act="' + a + '"]'), function (x) { return x.getAttribute("data-value") === v && x.getAttribute("data-table") === el.getAttribute("data-table"); })[0];
    if (again && !again.disabled) again.focus({ preventScroll: true });
  }

  // ---------- one-time setup ----------
  var taken = new Date(D.takenAt);
  $("meta").innerHTML = "Saved <b>" + esc(taken.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })) + "</b> at shift clock <b class=\"num\">" + clock(D.shiftT) + "</b> · Viewed as <b>" + esc(D.viewer) + "</b> (" + esc(D.role) + ") · " + esc(D.span);
  $("source").lastChild.textContent = D.source;
  if (D.notice) { $("notice").textContent = D.notice; $("notice").hidden = false; }
  if (D.canExport) $("export").hidden = false;
  var mgrs = uniq(D.teams.map(function (t) { return t.mgr; }));
  $("f-mgr").innerHTML = options("All managers", mgrs, "");
  $("f-rule").innerHTML = options("All rules", uniq(D.ledger.map(function (r) { return r.rule; }).concat(D.incidents.map(function (i) { return i.rule; }))), "");
  if (mgrs.length < 2) $("mgr-slicer").hidden = true;
  if (D.teams.length < 2) $("team-slicer").hidden = true;

  $("f-mgr").addEventListener("change", function (e) { F.mgr = e.target.value; F.team = ""; render(); });
  $("f-team").addEventListener("change", function (e) { F.team = e.target.value; render(); });
  $("f-rule").addEventListener("change", function (e) { F.rule = e.target.value; render(); });
  $("f-agent").addEventListener("input", function (e) { F.agent = e.target.value; render(); });
  document.addEventListener("click", function (e) { var el = e.target.closest("[data-act]"); if (el) act(el); });
  document.addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("tr[data-act]")) { e.preventDefault(); act(e.target); }
  });
  render();
})();
`;
