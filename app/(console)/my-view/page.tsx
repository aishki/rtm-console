"use client";

import { useMemo, useState } from "react";
import { clock, fmt } from "@/lib/engine/format";
import { STATES, type Target, myTargets } from "@/lib/engine/rules";
import { teamOf } from "@/lib/engine/scope";
import { api, attempt } from "@/lib/client/api";
import { useConsole } from "@/lib/client/store";
import { STAGE, TGT } from "@/lib/ui/palette";
import type { Instance, Stage } from "@/lib/types";
import { PurpleButton } from "@/components/ui/buttons";
import { type Column, DataTable } from "@/components/ui/DataTable";
import { StatusPill } from "@/components/ui/primitives";

const VISIBILITY: Record<Stage, string> = {
  nudge: "Private nudge, only you saw this",
  lead: "Raised to your TL",
  ops: "Escalated, incident opened",
};
const LOG_SIZE = 60;

const TARGET_COLUMNS: Column<Target>[] = [
  { key: "rule", header: "Rule", tdClass: "font-semibold", cell: r => r.name },
  { key: "cond", header: "Condition", tdClass: "text-muted", cell: r => r.cond },
  { key: "now", header: "You now", cell: r => <span className="num font-semibold" style={{ color: TGT[r.lvl].fg }}>{r.now}</span> },
  { key: "status", header: "Status", cell: r => <StatusPill tone={TGT[r.lvl]}>{r.stat}</StatusPill> },
];

/** Inline reason field for a call-out that has none yet. */
function ReasonInput({ n }: { n: number }) {
  const [draft, setDraft] = useState("");
  const toast = useConsole(s => s.toast);
  const save = async () => {
    const text = draft.trim();
    if (!text) { toast("warn", "Nothing to save", "Type your reason first. One line is enough."); return; }
    if (await attempt(api.comment(n, text, false))) toast("info", "Comment logged", "Your reason is attached to the instance and visible to your TL, the ledger and exports.");
  };
  return (
    <div className="flex items-center gap-2">
      <input
        value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void save(); }}
        maxLength={140} placeholder="Why did this happen?" aria-label="Your reason"
        className="field h-[34px] min-w-[120px] flex-1 px-2.5 text-[13px]"
      />
      <PurpleButton compact variant="outline" onClick={save}>Save</PurpleButton>
    </div>
  );
}

const LOG_COLUMNS: Column<Instance>[] = [
  { key: "time", header: "Time", tdClass: "num", cell: r => clock(r.t) },
  { key: "rule", header: "Rule", tdClass: "font-semibold", cell: r => r.rule },
  { key: "val", header: "Value", tdClass: "num", cell: r => r.val },
  { key: "vis", header: "Visibility", cell: r => <StatusPill tone={STAGE[r.stage]} className="whitespace-nowrap">{VISIBILITY[r.stage]}</StatusPill> },
  { key: "reason", header: "Your reason", thClass: "min-w-[240px]", cell: r => (r.cmt ? <span className="text-[13px] text-purple-900">“{r.cmt}”</span> : <ReasonInput n={r.n} />) },
];

export default function MyViewPage() {
  const who = useConsole(s => s.view?.who);
  const me = useConsole(s => s.agents.find(a => a.name === who));
  const rules = useConsole(s => s.rules);
  const org = useConsole(s => s.org);
  const ledger = useConsole(s => s.ledger);
  const targets = useMemo(() => (me ? myTargets(me, rules) : []), [me, rules]);
  const log = useMemo(() => ledger.slice(0, LOG_SIZE), [ledger]);

  const state = me ? STATES[me.state] ?? STATES.avail : null;
  const team = me ? teamOf(org, me.team) : null;
  const metric = (label: string, value: string | number) => <span>{label} <b className="font-bold text-ink">{value}</b></span>;

  return (
    <section className="flex flex-wrap items-start gap-6">
      <div className="flex max-w-[400px] flex-[1_1_320px] flex-col gap-6">
        <div className="panel flex flex-col items-center gap-1.5 px-6 py-7 text-center">
          {me && state && team ? (
            <>
              <span className="text-[28px] font-medium tracking-[-0.02em] text-purple">{me.name}</span>
              <span className="text-[13px] text-muted">{me.team} · TL {team.tl} · Mgr {team.mgr}</span>
              <div className="mt-[18px] inline-flex items-center gap-2 text-base font-medium">
                <span className="h-3 w-3 rounded-full" style={{ background: state.color }} />{state.label}
                {me.onHold && <span className="rounded-pill bg-warning-tint px-2 py-px font-ui text-xs font-semibold text-warning-text">Hold</span>}
              </div>
              <span className="num text-[64px] font-semibold leading-[1.1] tracking-[-0.02em]">{fmt(me.stTime)}</span>
              <div className="num mt-2 flex flex-wrap justify-center gap-4 text-xs text-muted">
                {metric("AHT", me.aht + "s")}{metric("Calls", me.calls)}{metric("Xfr", me.transfers)}{metric("Short", me.shortCalls)}{metric("Adh", me.adh.toFixed(0) + "%")}
              </div>
            </>
          ) : (
            <span className="text-muted">Pick an agent in the View as selector above.</span>
          )}
        </div>
        <div className="panel">
          <div className="border-b border-pale-purple px-5 py-[18px]"><h2 className="panel-title">What pops up to me</h2></div>
          <p className="m-0 text-pretty px-5 pb-5 pt-4 text-sm leading-[1.6] text-strong">
            When any of your timers crosses its nudge threshold, a <b className="text-ink">private pop-up appears at the bottom-left of your screen</b>, before any leader is involved. “Got it” closes it; “On a case, 2 min” snoozes it once. Your TL is only alerted on a repeat, and a third occurrence opens an incident. Nothing here is hidden from you: every call-out you generate is listed with who saw it, and you can attach your reason to any of them.
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-[2_1_560px] flex-col gap-6">
        <div className="panel overflow-hidden">
          <div className="panel-head">
            <h2 className="panel-title">My targets &amp; timers</h2>
            <span className="panel-sub">The thresholds this console watches for you</span>
          </div>
          <div className="overflow-x-auto">
            <DataTable columns={TARGET_COLUMNS} rows={targets} rowKey={r => r.id} padY={12} padX={16} />
          </div>
        </div>
        <div className="panel overflow-hidden">
          <div className="panel-head">
            <h2 className="panel-title">My call-outs today</h2>
            <span className="panel-sub">{ledger.length} today · add your reason to any of them</span>
          </div>
          <div className="max-h-[420px] overflow-auto">
            <DataTable columns={LOG_COLUMNS} rows={log} rowKey={r => r.n} padX={16} empty={me ? "Nothing yet. You're inside every target." : undefined} />
          </div>
        </div>
      </div>
    </section>
  );
}
