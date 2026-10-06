"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { clock } from "@/lib/engine/format";
import { DISPOSITIONS } from "@/lib/engine/rules";
import { api, attempt, download } from "@/lib/client/api";
import { avgResponse, usePerms } from "@/lib/client/hooks";
import { useConsole } from "@/lib/client/store";
import { INC, STAGE } from "@/lib/ui/palette";
import type { Incident, Instance, Stage } from "@/lib/types";
import { CsvImportDialog } from "@/components/chrome/CsvImportDialog";
import { PurpleButton } from "@/components/ui/buttons";
import { type Column, DataTable } from "@/components/ui/DataTable";
import { type Kpi, KpiTile, PageTitle, StatusPill } from "@/components/ui/primitives";

type Counts = Record<Stage, number> & { total: number };
interface Bar { label: string; counts: Counts }

/** Call-outs grouped by a key, biggest first. */
function tally(rows: Instance[], key: (r: Instance) => string, cap?: number): Bar[] {
  const m = new Map<string, Counts>();
  for (const r of rows) {
    const c = m.get(key(r)) ?? { nudge: 0, lead: 0, ops: 0, total: 0 };
    c[r.stage]++; c.total++;
    m.set(key(r), c);
  }
  const out = [...m].map(([label, counts]) => ({ label, counts })).sort((a, b) => b.counts.total - a.counts.total);
  return cap ? out.slice(0, cap) : out;
}

function BarChart({ title, sub, bars, note }: { title: string; sub: string; bars: Bar[]; note?: string }) {
  const max = Math.max(1, ...bars.map(b => b.counts.total));
  const pct = (n: number) => `${(n / max) * 100}%`;
  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{title}</h2>
        <span className="panel-sub">{sub}</span>
      </div>
      <div className="flex flex-col gap-2.5 px-5 py-3.5">
        {bars.map(b => (
          <div key={b.label} className="grid grid-cols-[150px_minmax(0,1fr)_36px] items-center gap-3 text-[13px]">
            <span className="truncate text-strong">{b.label}</span>
            <div className="flex h-3.5 overflow-hidden rounded-4 bg-page" role="img" aria-label={`${b.counts.nudge} nudge, ${b.counts.lead} leader, ${b.counts.ops} ops`}>
              <span className="h-full" style={{ width: pct(b.counts.nudge), background: STAGE.nudge.solid }} />
              <span className="h-full" style={{ width: pct(b.counts.lead), background: STAGE.lead.solid }} />
              <span className="h-full" style={{ width: pct(b.counts.ops), background: STAGE.ops.solid }} />
            </div>
            <span className="num text-right font-semibold">{b.counts.total}</span>
          </div>
        ))}
        {bars.length === 0 && <div className="py-6 text-center text-muted">No call-outs yet this shift.</div>}
      </div>
      <div className="flex flex-wrap items-center gap-4 px-5 pb-[18px] pt-1 text-xs text-muted">
        {(["nudge", "lead", "ops"] as const).map(s => (
          <span key={s} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: STAGE[s].solid }} />{STAGE[s].label}</span>
        ))}
        {note && <span>{note}</span>}
      </div>
    </div>
  );
}

/** Start / disposition + close / closed note, for roles with investigation actions. */
function IncidentAction({ incident: i, canAct }: { incident: Incident; canAct: boolean }) {
  const [disposition, setDisposition] = useState(DISPOSITIONS[0]);
  const toast = useConsole(s => s.toast);
  const note = i.status === "Closed" ? `Closed ${clock(i.closedT ?? 0)}` : !canAct ? "Read-only in this view" : "";
  const close = async () => {
    const res = await attempt(api.incident(i.inc, "close", disposition));
    if (res) toast("info", `${res.incident.inc} closed`, `${res.incident.agent} · ${res.incident.rule} · ${res.incident.disposition}`);
  };
  return (
    <div className="flex items-center gap-2">
      {canAct && i.status === "Open" && <PurpleButton compact onClick={() => void attempt(api.incident(i.inc, "start"))}>Start investigation</PurpleButton>}
      {canAct && i.status === "Investigating" && (
        <>
          <select value={disposition} onChange={e => setDisposition(e.target.value)} aria-label={`Disposition for ${i.inc}`} className="field h-8 px-2 text-[13px]">
            {DISPOSITIONS.map(d => <option key={d}>{d}</option>)}
          </select>
          <PurpleButton compact onClick={close}>Close</PurpleButton>
        </>
      )}
      {note && <span className="text-[13px] text-muted">{note}</span>}
    </div>
  );
}

interface TeamRow { team: string; tl: string; mgr: string; agents: number; n: number; l: number; o: number; ir: number; top: string }
const stageHead = "";
const TEAM_COLUMNS: Column<TeamRow>[] = [
  { key: "team", header: "Team", tdClass: "font-semibold", cell: t => t.team },
  { key: "tl", header: "Team Lead", cell: t => t.tl },
  { key: "mgr", header: "Manager", tdClass: "text-muted", cell: t => t.mgr },
  { key: "agents", header: "Agents", align: "right", tdClass: "font-ui", cell: t => t.agents },
  { key: "n", header: "Nudges", align: "right", thClass: `${stageHead} !text-turquoise-text`, tdClass: "font-ui font-semibold", cell: t => t.n },
  { key: "l", header: "Leader", align: "right", thClass: `${stageHead} !text-warning-text`, tdClass: "font-ui font-semibold", cell: t => t.l },
  { key: "o", header: "Ops", align: "right", thClass: `${stageHead} !text-purple`, tdClass: "font-ui font-semibold", cell: t => t.o },
  { key: "ir", header: "Open IR", align: "right", thClass: `${stageHead} !text-error-text`, tdClass: "font-ui font-semibold", cell: t => <span className={t.ir ? "text-error-text" : "text-subtle"}>{t.ir}</span> },
  { key: "top", header: "Top cause", tdClass: "text-strong", cell: t => t.top },
];

export default function DashboardsPage() {
  const perms = usePerms();
  const ledger = useConsole(s => s.ledger);
  const incidents = useConsole(s => s.incidents);
  const teams = useConsole(s => s.org);
  const agents = useConsole(s => s.agents);
  const toast = useConsole(s => s.toast);
  const router = useRouter();
  const [csvOpen, setCsvOpen] = useState(false);
  const canAct = !!perms?.invAct;

  const openInv = incidents.filter(i => i.status !== "Closed").length;
  const kpis = useMemo<Kpi[]>(() => {
    const by = (s: Stage) => ledger.filter(r => r.stage === s).length;
    return [
      { label: "Call-outs (shift)", value: ledger.length, sub: "All stages · your span", level: "ok" },
      { label: "Nudges", value: by("nudge"), sub: "Agent self-corrections", level: "ok" },
      { label: "Leader alerts", value: by("lead"), sub: "Needed intervention", level: by("lead") > 8 ? "warn" : "ok" },
      { label: "Ops escalations", value: by("ops"), sub: "3× rule", level: by("ops") > 0 ? "esc" : "ok" },
      { label: "Open investigations", value: openInv, sub: `${incidents.length} incidents in span`, level: openInv > 0 ? "crit" : "ok" },
      { label: "Avg leader response", value: avgResponse(ledger), sub: "Time to acknowledge", level: "ok" },
    ];
  }, [ledger, incidents, openInv]);
  const byRule = useMemo(() => tally(ledger, r => r.rule), [ledger]);
  const byAgent = useMemo(() => tally(ledger.filter(r => !r.isFloor), r => r.agent, 8), [ledger]);

  const incidentColumns: Column<Incident>[] = [
    { key: "inc", header: "Incident #", thClass: "whitespace-nowrap", tdClass: "whitespace-nowrap font-ui font-semibold text-purple", cell: i => i.inc },
    { key: "opened", header: "Opened", tdClass: "num", cell: i => clock(i.t) },
    { key: "agent", header: "Agent", tdClass: "whitespace-nowrap font-semibold", cell: i => i.agent },
    { key: "team", header: "Team", tdClass: "whitespace-nowrap text-muted", cell: i => i.team },
    { key: "rule", header: "Trigger rule", cell: i => i.rule },
    { key: "instances", header: "Instances", tdClass: "font-ui font-semibold", cell: i => `×${i.instances}` },
    { key: "status", header: "Status", cell: i => <StatusPill tone={INC[i.status]}>{i.status}</StatusPill> },
    { key: "disp", header: "Disposition", tdClass: "text-muted", cell: i => i.disposition || "—" },
    { key: "action", header: "Action", thClass: "min-w-[300px]", cell: i => <IncidentAction incident={i} canAct={canAct} /> },
  ];

  const teamRows = useMemo<TeamRow[]>(() => teams.map(t => {
    const rows = ledger.filter(r => !r.isFloor && r.team === t.team);
    const top = tally(rows, r => r.rule, 1)[0];
    return {
      team: t.team, tl: t.tl, mgr: t.mgr, agents: agents.filter(a => a.team === t.team).length,
      n: rows.filter(r => r.stage === "nudge").length, l: rows.filter(r => r.stage === "lead").length, o: rows.filter(r => r.stage === "ops").length,
      ir: incidents.filter(i => i.team === t.team && i.status !== "Closed").length, top: top ? `${top.label} ×${top.counts.total}` : "—",
    };
  }), [teams, ledger, agents, incidents]);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <PageTitle eyebrow="Review" title="Shift dashboards" />
        <div className="flex-1" />
        {perms?.replay && <PurpleButton variant="outline" onClick={() => setCsvOpen(true)}>Replay a Gencloud export</PurpleButton>}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-4">
        {kpis.map(k => <KpiTile key={k.label} kpi={k} />)}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-start gap-6">
        <BarChart title="Call-out summary by rule" sub="This shift, by escalation stage" bars={byRule} />
        <BarChart title="Call-out summary by top agents" sub="Instances per agent, this shift" bars={byAgent} note="Agents at ×3 open an investigation below." />
      </div>

      <div className="panel overflow-hidden">
        <div className="flex min-h-[38px] flex-wrap items-center gap-3 border-b border-pale-purple px-5 py-3.5">
          <h2 className="panel-title">Repeat offenders · investigation register</h2>
          <span className="panel-sub">{openInv} open · {incidents.length - openInv} closed · your span</span>
          <div className="flex-1" />
          {perms?.export && <PurpleButton variant="outline" onClick={() => download("/api/export/incidents")}>Export incidents CSV</PurpleButton>}
        </div>
        <div className="overflow-x-auto">
          <DataTable
            columns={incidentColumns} rows={incidents} rowKey={i => i.inc}
            empty="No agents currently meet the investigation threshold (3 instances of the same rule in one shift)."
          />
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="panel-head">
          <h2 className="panel-title">Breakdown by team</h2>
          <span className="panel-sub">Instances by stage, incidents and top cause, scoped to your view</span>
        </div>
        <div className="overflow-x-auto">
          <DataTable columns={TEAM_COLUMNS} rows={teamRows} rowKey={t => t.team} padY={12} />
        </div>
      </div>

      {csvOpen && (
        <CsvImportDialog
          onClose={() => setCsvOpen(false)}
          onStarted={() => {
            setCsvOpen(false);
            toast("info", "Replay started at 60×", "The rules engine is processing your Gencloud day. Results land in Dashboards and the Instance Ledger.");
            router.push("/console");
          }}
        />
      )}
    </section>
  );
}
