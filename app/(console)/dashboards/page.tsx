"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { clock, splitAgent } from "@/lib/engine/format";
import { type LeadRow, agentQueues, leadRows } from "@/lib/engine/leadRows";
import { DISPOSITIONS, PENDING_DISPOSITION, canClose, ownerLabel } from "@/lib/engine/rules";
import { api, attempt, download } from "@/lib/client/api";
import { avgResponse, useMorph, usePerms } from "@/lib/client/hooks";
import { useConsole } from "@/lib/client/store";
import { INC, STAGE } from "@/lib/ui/palette";
import type { Incident, Instance, Stage } from "@/lib/types";
import { CsvImportDialog } from "@/components/chrome/CsvImportDialog";
import { IncidentNotesDialog, type NotesMode } from "@/components/chrome/IncidentNotesDialog";
import { PurpleButton } from "@/components/ui/buttons";
import { type Column, DataTable } from "@/components/ui/DataTable";
import { MorphText } from "@/components/ui/MorphText";
import { type Kpi, KpiTile, PageTitle, StatusPill } from "@/components/ui/primitives";
import { queueFilterOptions } from "@/lib/client/queueOptions";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { SearchBox, nameOrIdMatches } from "@/components/ui/SearchBox";
import { Select } from "@/components/ui/Select";

type Counts = Record<Stage, number> & { total: number };
/** `key` tells bars apart (an agent's uid); `label` is shown. */
interface Bar { key: string; label: string; counts: Counts }
/** Picked instead of a disposition: the investigation is dropped and the incident goes back to Open. */
const REOPEN = "reopen";
const DISPOSITION_OPTIONS = [...DISPOSITIONS.map(d => ({ value: d, label: d })), { value: REOPEN, label: "None · back to Open" }];
const NO_DISPOSITION = { value: "", label: "Select disposition" };

/** Call-outs grouped by a key, biggest first. */
function tally(rows: Instance[], key: (r: Instance) => string, cap?: number, label: (r: Instance) => string = key): Bar[] {
  const m = new Map<string, Bar>();
  for (const r of rows) {
    const k = key(r);
    const b = m.get(k) ?? { key: k, label: label(r), counts: { nudge: 0, lead: 0, ops: 0, total: 0 } };
    b.counts[r.stage]++; b.counts.total++;
    m.set(k, b);
  }
  const out = [...m.values()].sort((a, b) => b.counts.total - a.counts.total);
  return cap ? out.slice(0, cap) : out;
}

/** `people` marks a chart of agents: the domain ID goes under the name, in a wider label column. */
function BarChart({ title, sub, bars, note, people }: { title: string; sub: string; bars: Bar[]; note?: string; people?: boolean }) {
  const max = Math.max(1, ...bars.map(b => b.counts.total));
  const pct = (n: number) => `${(n / max) * 100}%`;
  return (
    // A column whose bars take the spare height, so side-by-side charts end level with their legends on one line.
    <div className="panel flex flex-col">
      <div className="panel-head">
        <h2 className="panel-title">{title}</h2>
        <span className="panel-sub">{sub}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 px-5 py-3.5">
        {bars.map(b => {
          const { who, id } = people ? splitAgent(b.label) : { who: b.label, id: "" };
          return (
          <div key={b.key} className={`grid items-center gap-3 text-[13px] ${people ? "grid-cols-[190px_minmax(0,1fr)_36px]" : "grid-cols-[150px_minmax(0,1fr)_36px]"}`}>
            <span title={b.label} className="flex min-w-0 flex-col text-strong">
              <span className="truncate">{who}</span>
              {id && <span className="num truncate text-[11px] text-muted">{id}</span>}
            </span>
            <div className="flex h-3.5 overflow-hidden rounded-4 bg-page" role="img" aria-label={`${b.counts.nudge} nudge, ${b.counts.lead} leader, ${b.counts.ops} ops`}>
              <span className="h-full" style={{ width: pct(b.counts.nudge), background: STAGE.nudge.solid }} />
              <span className="h-full" style={{ width: pct(b.counts.lead), background: STAGE.lead.solid }} />
              <span className="h-full" style={{ width: pct(b.counts.ops), background: STAGE.ops.solid }} />
            </div>
            <span className="num text-right font-semibold">{b.counts.total}</span>
          </div>
          );
        })}
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

/**
 * Start / disposition + notes + close / closed note, for roles with investigation actions. Picking a disposition records it
 * straight away and folds the list into an "Update disposition" button, which opens the list again to change it.
 * "Close incident" unlocks once a final one is recorded (not "Pending Investigation") and asks for the closing note;
 * "None" sends the incident back to Open. Notes are kept while it is investigated; anyone who sees the incident can read them.
 */
function IncidentAction({ incident: i, canAct }: { incident: Incident; canAct: boolean }) {
  const toast = useConsole(s => s.toast);
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<NotesMode | null>(null);
  // Starting, recording, closing and reopening swap these controls: fade them in and out and slide between sizes.
  const box = useRef<HTMLDivElement>(null);
  useMorph(box);
  const note = i.status === "Closed" ? `Closed ${clock(i.closedT ?? 0)}` : !canAct ? "Read-only in this view" : "";
  const pick = (v: string) => { setEditing(false); void attempt(v === REOPEN ? api.incident(i.inc, "reopen") : api.incident(i.inc, "record", v)); };
  const closable = canClose(i.disposition);
  const closeHint = closable ? undefined : i.disposition === PENDING_DISPOSITION ? "Change the disposition from Pending Investigation first" : "Record a disposition first";
  const save = async (text: string) => {
    if (dialog === "notes") return !!(await attempt(api.incident(i.inc, "note", text)));
    const res = await attempt(api.incident(i.inc, "close", text));
    if (res) toast("info", `${res.incident.inc} closed`, `${res.incident.agent} · ${res.incident.rule} · ${res.incident.disposition}`);
    return !!res;
  };
  const hasNotes = !!(i.comments || i.resolution);
  const investigating = canAct && i.status === "Investigating";
  // The disposition slot has one fixed width (the longest option) for both the button and the list, so the row never
  // shifts between them. Side by side on wide screens; below 1360px the other buttons wrap under it instead of
  // widening the table (the Team column would otherwise take the room and squeeze this cell).
  return (
    <div ref={box} className="flex flex-wrap items-center gap-2 min-[1360px]:w-max min-[1360px]:flex-nowrap">
      {canAct && i.status === "Open" && <PurpleButton compact onClick={() => void attempt(api.incident(i.inc, "start"))}>Start investigation</PurpleButton>}
      {investigating && (
        <>
          <div className="w-[212px] shrink-0">
            {i.disposition && !editing ? (
              <PurpleButton compact variant="outline" className="w-full" title={`Current disposition: ${i.disposition}`} onClick={() => setEditing(true)}>Update disposition</PurpleButton>
            ) : (
              <Select
                value={i.disposition} onChange={pick} options={i.disposition ? DISPOSITION_OPTIONS : [NO_DISPOSITION, ...DISPOSITION_OPTIONS]}
                aria-label={`Disposition for ${i.inc}`} className="field h-8 w-full px-2 text-[13px]"
                autoOpen={editing} onClose={editing ? () => setEditing(false) : undefined}
              />
            )}
          </div>
          <PurpleButton compact variant="outline" title={i.comments ? "Read or change the investigation notes" : "Keep notes on the investigation"} onClick={() => setDialog("notes")}>
            {i.comments ? "Edit notes" : "Add notes"}
          </PurpleButton>
          <PurpleButton compact disabled={!closable} title={closeHint} onClick={() => setDialog("close")}>Close incident</PurpleButton>
        </>
      )}
      {note && <span data-morph className="text-[13px] text-muted">{note}</span>}
      {!investigating && hasNotes && <PurpleButton compact variant="outline" onClick={() => setDialog("view")}>View notes</PurpleButton>}
      {dialog && <IncidentNotesDialog incident={i} mode={dialog} onClose={() => setDialog(null)} onSave={save} />}
    </div>
  );
}

const stageHead = "";
const LEAD_COLUMNS: Column<LeadRow>[] = [
  { key: "tl", header: "Team Lead", tdClass: "font-semibold", cell: t => t.tl },
  { key: "mgr", header: "Manager", tdClass: "text-muted", cell: t => t.mgr },
  { key: "agents", header: "Agents", align: "right", tdClass: "font-ui", cell: t => t.agents },
  // Where the Team Lead's agents sit: the first two queues, then a count; hover for the full list.
  {
    key: "queues", header: "Queues", tdClass: "text-muted", cell: t => (
      <span title={t.queues.join("\n")} className="whitespace-nowrap">
        {t.queues.slice(0, 2).join(", ") || "—"}{t.queues.length > 2 && <span className="font-ui font-semibold text-strong"> +{t.queues.length - 2}</span>}
      </span>
    ),
  },
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
  const leads = useConsole(s => s.leads);
  const agents = useConsole(s => s.agents);
  const members = useConsole(s => s.members);
  const unsupervised = useConsole(s => s.unsupervised);
  const severalLobs = useConsole(s => s.severalLobs);
  const toast = useConsole(s => s.toast);
  // Importing a file starts a replay, which is not offered on the live Genesys feed.
  const canImport = useConsole(s => s.feed !== "gencloud") && !!perms?.replay;
  const router = useRouter();
  const [csvOpen, setCsvOpen] = useState(false);
  const canAct = !!perms?.invAct;

  const openInv = incidents.filter(i => i.status !== "Closed").length;
  const [incQuery, setIncQuery] = useState("");
  const [incQueues, setIncQueues] = useState<string[]>([]);
  const queueMap = useConsole(s => s.queueMap);
  const incQueueOptions = useMemo(() => queueFilterOptions(incidents.map(i => i.team), queueMap), [incidents, queueMap]);
  const shownIncidents = useMemo(
    () => incidents.filter(i => (!incQueues.length || incQueues.includes(i.team)) && nameOrIdMatches(i.agent, incQuery)),
    [incidents, incQueues, incQuery],
  );
  const incFiltering = !!(incQueues.length || incQuery.trim());
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
  const byAgent = useMemo(() => tally(ledger.filter(r => !r.isFloor), r => r.agentId ?? r.agent, 8, r => r.agent), [ledger]);

  const incidentColumns: Column<Incident>[] = [
    // Below 1280px the Opened time folds under the incident number and the count next to the rule,
    // so the table fits without scrolling sideways.
    {
      key: "inc", header: "Incident #", thClass: "whitespace-nowrap", tdClass: "whitespace-nowrap", cell: i => (
        <span className="flex flex-col gap-0.5">
          <span className="font-ui font-semibold text-purple">{i.inc}</span>
          <span className="num text-[11px] text-muted xl:hidden">Opened {clock(i.t)}</span>
        </span>
      ),
    },
    { key: "opened", header: "Opened", thClass: "max-xl:hidden", tdClass: "num max-xl:hidden", cell: i => clock(i.t) },
    // The domain ID sits under the name, so the column stays narrow and "Trigger rule" keeps to one line.
    // Long names wrap rather than widen the table.
    {
      key: "agent", header: "Agent", thClass: "min-w-[120px]", cell: i => {
        const { who, id } = splitAgent(i.agent);
        return <span className="flex flex-col gap-0.5"><span className="font-semibold">{who}</span>{id && <span className="num whitespace-nowrap text-[11px] text-muted">{id}</span>}</span>;
      },
    },
    // Team takes whatever width is left and ellipsises, so the Action buttons never slide off the panel.
    { key: "team", header: "Team", thClass: "w-full min-w-[80px]", tdClass: "max-w-0 truncate text-muted", cell: i => <span title={i.team}>{i.team}</span> },
    // One line from 1280px up; below that it may wrap, so the table never scrolls sideways.
    {
      key: "rule", header: "Trigger rule", thClass: "xl:whitespace-nowrap", tdClass: "xl:whitespace-nowrap",
      cell: i => <>{i.rule}<span className="font-ui font-semibold xl:hidden"> ×{i.instances}</span></>,
    },
    { key: "instances", header: "Instances", thClass: "max-xl:hidden", tdClass: "font-ui font-semibold max-xl:hidden", cell: i => `×${i.instances}` },
    // The owner (whoever started the investigation) sits under the status, so the table needs no extra column.
    {
      key: "status", header: "Status", cell: i => (
        <span className="flex flex-col items-start gap-1">
          <StatusPill tone={INC[i.status]}>{i.status}</StatusPill>
          {i.owner && <span className="whitespace-nowrap text-[11px] text-muted" title="Started the investigation">Owner · {splitAgent(ownerLabel(i.owner)).who}</span>}
        </span>
      ),
    },
    { key: "disp", header: "Disposition", thClass: "min-w-[120px]", tdClass: "text-muted", cell: i => <MorphText>{i.disposition || "—"}</MorphText> },
    { key: "action", header: "Action", cell: i => <IncidentAction incident={i} canAct={canAct} /> },
  ];

  const queuesByAgent = useMemo(() => agentQueues(agents, members), [agents, members]);
  const queueNames = useMemo(() => [...new Set([...queuesByAgent.values()].flat())].sort((a, b) => a.localeCompare(b)), [queuesByAgent]);
  const [queuePick, setQueuePick] = useState("");
  // A queue that has left the viewer's span (a new roster, another "View as") stops filtering.
  const queue = queueNames.includes(queuePick) ? queuePick : "";
  const leadTable = useMemo(
    () => leadRows(agents, uid => leads[uid], uid => queuesByAgent.get(uid) ?? [], ledger, incidents, queue),
    [agents, leads, queuesByAgent, ledger, incidents, queue],
  );

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <PageTitle eyebrow="Review" title="Shift dashboards" />
        <div className="flex-1" />
        {canImport && <PurpleButton variant="outline" onClick={() => setCsvOpen(true)}>Import floor data</PurpleButton>}
        <PurpleButton variant="outline" title="Download this dashboard as a read-only HTML file with working filters" onClick={() => download("/api/export/snapshot")}>Save snapshot</PurpleButton>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-4">
        {kpis.map(k => <KpiTile key={k.label} kpi={k} />)}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] gap-6">
        <BarChart title="Call-out summary by rule" sub="This shift, by escalation stage" bars={byRule} />
        <BarChart title="Call-out summary by top agents" sub="Instances per agent, this shift" bars={byAgent} people note="Agents at ×3 open an investigation below." />
      </div>

      {/* Not overflow-hidden: the queue filter's list has to drop out of the panel when the register is short. */}
      <div className="panel">
        <div className="flex min-h-[38px] flex-wrap items-center gap-3 border-b border-pale-purple px-5 py-3.5">
          <h2 className="panel-title">Repeat offenders · investigation register</h2>
          <span className="panel-sub">{openInv} open · {incidents.length - openInv} closed · your span{incFiltering ? ` · ${shownIncidents.length} shown` : ""}</span>
          <div className="flex-1" />
          {incQueueOptions.length > 1 && (
            <MultiSelect
              value={incQueues} onChange={setIncQueues} options={incQueueOptions} anyLabel={`All queues (${incQueueOptions.length})`} countLabel={n => `${n} queues`}
              aria-label="Filter the investigation register by queue" className="field h-[38px] !max-w-[240px] px-3"
            />
          )}
          <SearchBox value={incQuery} onChange={setIncQuery} aria-label="Search the investigation register by agent" placeholder="Search name or ID" className="w-full sm:w-[260px]" height="h-[38px]" />
          {perms?.export && <PurpleButton variant="outline" onClick={() => download("/api/export/incidents")}>Export incidents CSV</PurpleButton>}
          {perms?.mapping && unsupervised > 0 && (
            <PurpleButton variant="outline" title="Agents with no supervisor in Genesys or the CGS directory: their call-outs reach admins only until one is set in Genesys" onClick={() => download("/api/export/no-supervisor")}>
              No supervisor ({unsupervised}) CSV
            </PurpleButton>
          )}
          {perms?.mapping && severalLobs > 0 && (
            <PurpleButton variant="outline" title="Agents whose queues are in more than one LOB in the queue mapping: their rules follow the LOB with most of their queues" onClick={() => download("/api/export/several-lobs")}>
              Several LOBs ({severalLobs}) CSV
            </PurpleButton>
          )}
        </div>
        <div className="overflow-x-auto rounded-b-[20px]">
          <DataTable
            columns={incidentColumns} rows={shownIncidents} rowKey={i => i.inc}
            empty={incFiltering ? "No incidents match the search and queue filter." : "No agents currently meet the investigation threshold (3 instances of the same rule in one shift)."}
          />
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="flex min-h-[38px] flex-wrap items-center gap-3 border-b border-pale-purple px-5 py-3.5">
          <h2 className="panel-title">Breakdown by Team Lead</h2>
          <span className="panel-sub">Instances by stage, incidents and top cause, scoped to your view</span>
          <div className="flex-1" />
          {queueNames.length > 1 && (
            <Select
              value={queue} onChange={setQueuePick} aria-label="Show only agents in this queue" className="field h-8 px-2 text-[13px]"
              options={[{ value: "", label: "All queues" }, ...queueNames.map(q => ({ value: q, label: q }))]}
            />
          )}
        </div>
        <div className="overflow-x-auto">
          <DataTable columns={LEAD_COLUMNS} rows={leadTable} rowKey={t => t.tl} padY={12} empty="No agents in this queue are in your view." />
        </div>
      </div>

      {csvOpen && canImport && (
        <CsvImportDialog
          onClose={() => setCsvOpen(false)}
          onStarted={() => {
            setCsvOpen(false);
            toast("info", "Replay started at 60×", "The rules engine is processing the imported day. Results land in Dashboards and the Instance Ledger.");
            router.push("/console");
          }}
        />
      )}
    </section>
  );
}
