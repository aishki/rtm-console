"use client";

import { useMemo, useState } from "react";
import { clock } from "@/lib/engine/format";
import { api, attempt, download } from "@/lib/client/api";
import { avgResponse, usePerms } from "@/lib/client/hooks";
import { useConsole } from "@/lib/client/store";
import { STAGE } from "@/lib/ui/palette";
import type { Instance, Stage } from "@/lib/types";
import { PurpleButton } from "@/components/ui/buttons";
import { type Column, DataTable } from "@/components/ui/DataTable";
import { PageTitle, StatusPill } from "@/components/ui/primitives";

const MAX_ROWS = 250;

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

export default function LedgerPage() {
  const perms = usePerms();
  const ledger = useConsole(s => s.ledger);
  const toast = useConsole(s => s.toast);
  const [stage, setStage] = useState<Stage | "">("");

  const rows = useMemo(() => (stage ? ledger.filter(r => r.stage === stage) : ledger).slice(0, MAX_ROWS), [ledger, stage]);
  const open = useMemo(() => ledger.filter(r => r.status === "open").length, [ledger]);
  const stats = [
    { label: "Total", value: ledger.length, amber: false },
    { label: "Open", value: open, amber: open > 0 },
    { label: "Avg leader response", value: avgResponse(ledger), amber: false },
  ];
  const ackAll = async () => {
    const res = await attempt(api.ackAll());
    if (res) toast("info", "Bulk acknowledge", `${res.count} open instance(s) acknowledged across the span.`);
  };

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-4">
        <PageTitle eyebrow="Review" title="Instance ledger" />
        <div className="flex-1" />
        <select value={stage} onChange={e => setStage(e.target.value as Stage | "")} aria-label="Filter by stage" className="field h-[38px] px-3">
          <option value="">All stages</option>
          <option value="nudge">Nudge (agent)</option>
          <option value="lead">Leader alert</option>
          <option value="ops">Ops escalation</option>
        </select>
        {perms?.export && <PurpleButton variant="outline" onClick={() => download("/api/export/ledger")}>Export CSV</PurpleButton>}
        {perms?.ackAll && <PurpleButton onClick={ackAll}>Acknowledge all open</PurpleButton>}
      </div>
      <div className="grid max-w-[640px] grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-4">
        {stats.map(k => (
          <div key={k.label} className="flex flex-col gap-1 rounded-16 bg-white px-[18px] py-3.5">
            <span className="text-[13px] font-medium text-muted">{k.label}</span>
            <span className={`num text-[26px] font-semibold tracking-[-0.02em] ${k.amber ? "text-warning-text" : "text-ink"}`}>{k.value}</span>
          </div>
        ))}
      </div>
      <div className="panel max-h-[calc(100vh-380px)] min-h-80 overflow-auto">
        <DataTable columns={COLUMNS} rows={rows} rowKey={r => r.n} stickyHeader padX={12} empty="No instances match this filter." />
      </div>
    </section>
  );
}
