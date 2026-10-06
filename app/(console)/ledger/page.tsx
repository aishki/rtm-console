"use client";

import { useMemo, useState } from "react";
import { clock } from "@/lib/engine/format";
import { api, attempt, download } from "@/lib/client/api";
import { avgResponse, usePerms } from "@/lib/client/hooks";
import { useConsole } from "@/lib/client/store";
import { STAGE, STAGE_ORDER } from "@/lib/ui/palette";
import type { Instance, Stage } from "@/lib/types";
import { PurpleButton } from "@/components/ui/buttons";
import { type Column, DataTable } from "@/components/ui/DataTable";
import { type Kpi, KpiTile, PageTitle, StatusPill } from "@/components/ui/primitives";
import { Select, type SelectOption } from "@/components/ui/Select";

const MAX_ROWS = 250;
const STAGE_FILTERS: SelectOption<Stage | "">[] = [
  { value: "", label: "All stages" },
  { value: "nudge", label: "Nudge (agent)" },
  { value: "lead", label: "Leader alert" },
  { value: "ops", label: "Ops escalation" },
];

const COLUMNS: Column<Instance>[] = [
  { key: "n", header: "#", tdClass: "font-ui text-muted", cell: r => r.n },
  { key: "time", header: "Time", tdClass: "num", cell: r => clock(r.t) },
  { key: "agent", header: "Agent", tdClass: "whitespace-nowrap font-semibold", cell: r => r.agent },
  { key: "team", header: "Team", tdClass: "whitespace-nowrap text-muted", cell: r => r.team },
  { key: "rule", header: "Rule", tdClass: "whitespace-nowrap", cell: r => r.rule },
  { key: "val", header: "Value", tdClass: "num whitespace-nowrap", cell: r => r.val },
  { key: "stage", header: "Stage", cell: r => <StatusPill tone={STAGE[r.stage]}>{STAGE[r.stage].label}</StatusPill> },
  { key: "inc", header: "Incident", tdClass: "whitespace-nowrap font-ui font-semibold text-purple", cell: r => r.inc || "—" },
  { key: "status", header: "Status", cell: r => <span className={`text-xs font-semibold ${r.status === "open" ? "text-warning-text" : "text-success-text"}`}>{r.status === "open" ? "Open" : "Acknowledged"}</span> },
  { key: "resp", header: "Resp (s)", align: "right", tdClass: "num", cell: r => (r.ackT !== null ? r.ackT - r.t : "—") },
  { key: "cmt", header: "Agent comment", tdClass: "max-w-[260px] text-[13px] text-purple-900", cell: r => (r.cmt ? `“${r.cmt}”` : "—") },
];

/** Fourth tile: the ledger split by escalation stage, as one stacked bar with its legend. */
function StageMix({ byStage }: { byStage: { stage: Stage; count: number }[] }) {
  const total = byStage.reduce((sum, s) => sum + s.count, 0);
  return (
    <div className="flex flex-col justify-between gap-3 rounded-16 bg-white px-[18px] py-4 sm:col-span-2">
      <span className="text-[13px] font-medium text-muted">By escalation stage</span>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-pill bg-page" aria-hidden="true">
        {byStage.filter(s => s.count > 0).map(s => (
          <span key={s.stage} className="h-full min-w-1.5 transition-[flex-grow] duration-200 ease-standard" style={{ flexGrow: s.count, flexBasis: 0, background: STAGE[s.stage].solid }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {byStage.map(s => (
          <span key={s.stage} className="flex items-center gap-2 text-xs text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: STAGE[s.stage].solid }} />
            {STAGE[s.stage].label}
            <span className="num text-sm font-semibold text-ink">{s.count}</span>
            {total > 0 && <span className="num">{Math.round((s.count / total) * 100)}%</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function LedgerPage() {
  const perms = usePerms();
  const ledger = useConsole(s => s.ledger);
  const toast = useConsole(s => s.toast);
  const [stage, setStage] = useState<Stage | "">("");

  const rows = useMemo(() => (stage ? ledger.filter(r => r.stage === stage) : ledger).slice(0, MAX_ROWS), [ledger, stage]);
  const { kpis, byStage } = useMemo(() => {
    const total = ledger.length;
    const open = ledger.filter(r => r.status === "open").length;
    const acked = ledger.filter(r => r.ackT !== null).length;
    const kpis: Kpi[] = [
      { label: "Total instances", value: total, sub: "This shift · your span", level: "ok" },
      { label: "Open", value: open, sub: !total ? "Nothing logged yet" : open ? `${Math.round(((total - open) / total) * 100)}% acknowledged` : "All acknowledged", level: open > 0 ? "warn" : "ok" },
      { label: "Avg leader response", value: avgResponse(ledger), sub: acked ? `Across ${acked} acknowledged` : "No acknowledgements yet", level: "ok", muted: !acked },
    ];
    return { kpis, byStage: STAGE_ORDER.map(s => ({ stage: s, count: ledger.filter(r => r.stage === s).length })) };
  }, [ledger]);
  const ackAll = async () => {
    const res = await attempt(api.ackAll());
    if (res) toast("info", "Bulk acknowledge", `${res.count} open instance(s) acknowledged across the span.`);
  };

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-4">
        <PageTitle eyebrow="Review" title="Instance ledger" />
        <div className="flex-1" />
        <Select value={stage} onChange={setStage} options={STAGE_FILTERS} aria-label="Filter by stage" className="field h-[38px] px-3" />
        {perms?.export && <PurpleButton variant="outline" onClick={() => download("/api/export/ledger")}>Export CSV</PurpleButton>}
        {perms?.ackAll && <PurpleButton onClick={ackAll}>Acknowledge all open</PurpleButton>}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-4">
        {kpis.map(k => <KpiTile key={k.label} kpi={k} />)}
        <StageMix byStage={byStage} />
      </div>
      {/* Tall enough to fill the window under the sticky chrome once the page is scrolled to it. */}
      <div className="panel max-h-[calc(100vh-180px)] min-h-[480px] overflow-auto">
        <DataTable columns={COLUMNS} rows={rows} rowKey={r => r.n} stickyHeader padX={12} empty="No instances match this filter." />
      </div>
    </section>
  );
}
