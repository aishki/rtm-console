"use client";

import { useEffect, useRef, useState } from "react";
import { type CsvCols, type MappedState, buildEvents, distinctStatuses, guessCols, guessState, parseCSV, sampleCsv, splitTable } from "@/lib/csv/parse";
import { clock } from "@/lib/engine/format";
import { STATE_OPTIONS } from "@/lib/engine/rules";
import type { ImportSummary } from "@/lib/import/floor";
import { ApiError, api, download, downloadText } from "@/lib/client/api";
import { PurpleButton, TertiaryButton } from "@/components/ui/buttons";
import { Select, type SelectOption } from "@/components/ui/Select";

interface LoadedCsv { kind: "csv"; file: File; headers: string[]; rows: string[][]; cols: CsvCols; smap: Record<string, MappedState> }
interface LoadedWorkbook { kind: "xlsx"; file: File; summary: ImportSummary; warnings: string[] }
type Loaded = LoadedCsv | LoadedWorkbook;

const COLUMNS: { key: keyof CsvCols; label: string; required: boolean }[] = [
  { key: "agent", label: "Agent name", required: true },
  { key: "status", label: "Status / presence", required: true },
  { key: "start", label: "Start time", required: true },
  { key: "team", label: "Team", required: false },
];
const STATE_SELECT: SelectOption<MappedState>[] = STATE_OPTIONS.map(([value, label]) => ({ value, label }));
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const problems = (e: unknown, fallback: string) => (e instanceof ApiError ? e.details : [e instanceof Error ? e.message : fallback]);

/**
 * Import a day of floor data and replay it through the rules engine. Takes the filled-in
 * Excel template (roster, statuses, holds, queue intervals) or a raw Gencloud status CSV.
 */
export function CsvImportDialog({ onClose, onStarted }: { onClose: () => void; onStarted: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setErrors([]);
    if (/\.xlsx$/i.test(file.name)) {
      setBusy(true);
      try { setLoaded({ kind: "xlsx", file, ...(await api.validateImport(file)) }); }
      catch (e) { setLoaded(null); setErrors(problems(e, "The file could not be checked.")); }
      finally { setBusy(false); }
      return;
    }
    const all = parseCSV(await file.text());
    if (all.length < 2) { setLoaded(null); setErrors(["Could not read the file: fewer than 2 rows found. Upload the .xlsx template or a .csv export."]); return; }
    const { headers, rows } = splitTable(all);
    setLoaded({ kind: "csv", file, headers, rows, cols: guessCols(headers), smap: {} });
  };

  const csv = loaded?.kind === "csv" ? loaded : null;
  const book = loaded?.kind === "xlsx" ? loaded : null;
  const statuses = csv ? distinctStatuses(csv.rows, csv.cols.status) : [];
  const agentCount = csv ? new Set(csv.rows.map(r => (r[csv.cols.agent] || "").trim()).filter(Boolean)).size : 0;

  const start = async () => {
    if (!loaded) return;
    let mapping: { cols: CsvCols; smap: Record<string, MappedState> } | undefined;
    if (loaded.kind === "csv") {
      const smap = Object.fromEntries(statuses.map(s => [s, loaded.smap[s] || guessState(s)]));
      // Same check the server runs, so a bad mapping is reported before uploading.
      const res = buildEvents(loaded.rows, loaded.cols, smap);
      if ("error" in res) { setErrors([res.error]); return; }
      mapping = { cols: loaded.cols, smap };
    }
    setBusy(true);
    try { await api.startReplay(loaded.file, mapping); onStarted(); }
    catch (e) { setErrors(problems(e, "The replay could not be started.")); }
    finally { setBusy(false); }
  };

  const hint = busy && !loaded ? "Checking the file…"
    : book ? `${book.file.name} is ready. Drop another file to replace it.`
    : csv ? `${csv.rows.length} rows loaded. Drop another file to replace it.`
    : "Excel template (.xlsx), or a raw Gencloud agent-status export (.csv)";

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-auto bg-[rgba(35,30,51,0.5)] px-4 py-12">
      <div role="dialog" aria-modal="true" aria-label="Import floor data" className="box-border flex w-[min(760px,100%)] flex-col gap-[18px] rounded-20 bg-white p-7">
        <div className="flex flex-col gap-2">
          <h2 className="m-0 text-2xl font-medium leading-normal tracking-[-0.02em] text-purple">Import floor data</h2>
          <p className="m-0 text-pretty text-sm leading-[1.55] text-strong">
            Download the Excel template, fill in your roster and the day&apos;s agent statuses, and upload it. The console <b>replays the day through the live rules engine</b> at 60×: every trigger, strike and incident your floor would have generated. Only you see the replay; the live floor keeps running.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-15 bg-tint px-4 py-3">
          <div className="flex min-w-[240px] flex-1 flex-col gap-0.5">
            <span className="text-sm font-semibold text-purple-900">Step 1 · Get the template</span>
            <span className="text-[13px] leading-normal text-strong">Sheets for the roster, agent statuses, holds and queue intervals, with a sample day and instructions.</span>
          </div>
          <PurpleButton variant="outline" onClick={() => download("/api/import/template")}>Download template</PurpleButton>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-muted">Step 2 · Upload the filled-in file</span>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); void pick(e.dataTransfer.files[0]); }}
            className={`flex flex-col gap-1.5 rounded-15 border-2 border-dashed p-7 text-center transition-colors duration-200 ease-standard ${drag ? "border-purple bg-tint" : "border-primary-500 bg-white"}`}
          >
            <span className="text-[15px] text-ink">Drop the file here, or <b className="text-purple">browse</b></span>
            <span className="text-xs text-muted">{hint}</span>
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={e => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
        </div>

        {book && (
          <div className="flex flex-col gap-2">
            <span className="font-ui text-[13px] font-semibold text-turquoise-text">
              {count(book.summary.agents, "agent")} · {count(book.summary.teams, "team")} · {count(book.summary.events, "status change")} · {count(book.summary.holds, "hold")} · {count(book.summary.queueIntervals, "queue interval")} · {clock(book.summary.startT)} to {clock(book.summary.endT)}
            </span>
            {book.warnings.length > 0 && (
              <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] leading-normal text-warning-text">
                {book.warnings.map(w => <li key={w}>{w}</li>)}
              </ul>
            )}
          </div>
        )}

        {csv && (
          <div className="flex flex-col gap-2.5">
            <span className="text-sm font-semibold text-muted">Column mapping (auto-guessed, correct if needed)</span>
            {COLUMNS.map(c => (
              <label key={c.key} className="grid grid-cols-[200px_minmax(0,1fr)] items-center gap-3 text-sm">
                <span>{c.label} <span className={`text-xs font-semibold ${c.required ? "text-error-text" : "text-muted"}`}>{c.required ? "Required" : "Optional"}</span></span>
                <Select
                  value={String(csv.cols[c.key])} onChange={v => setLoaded({ ...csv, cols: { ...csv.cols, [c.key]: Number(v) } })} className="field h-9 px-2.5"
                  options={[...(c.required ? [] : [{ value: "-1", label: "None" }]), ...csv.headers.map((h, i) => ({ value: String(i), label: h }))]}
                />
              </label>
            ))}
            <span className="mt-2 text-sm font-semibold text-muted">Status mapping (Gencloud status to console state)</span>
            <div className="grid max-h-[220px] grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-x-5 gap-y-2 overflow-auto">
              {statuses.map(s => (
                <label key={s} className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-2.5">
                  <span className="truncate font-ui text-[13px] text-strong">{s}</span>
                  <Select value={csv.smap[s] || guessState(s)} onChange={v => setLoaded({ ...csv, smap: { ...csv.smap, [s]: v } })} options={STATE_SELECT} className="field h-[34px] px-2 text-[13px]" />
                </label>
              ))}
            </div>
            <span className="font-ui text-[13px] font-semibold text-turquoise-text">{csv.rows.length} rows · {agentCount} agents · {statuses.length} distinct statuses</span>
            <span className="text-[13px] leading-normal text-muted">A CSV export carries statuses only: teams get placeholder leaders, and there are no holds or queue metrics. Use the template for the full picture.</span>
          </div>
        )}

        {errors.length > 0 && (
          <ul role="alert" className={`m-0 flex flex-col gap-1 text-[13px] font-semibold leading-normal text-error-text ${errors.length > 1 ? "list-disc pl-5" : "list-none pl-0"}`}>
            {errors.map(e => <li key={e}>{e}</li>)}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          <TertiaryButton onClick={() => downloadText(sampleCsv(), "gencloud_agent_status_sample.csv")}>Download sample CSV</TertiaryButton>
          <div className="flex-1" />
          <PurpleButton variant="outline" onClick={onClose}>Cancel</PurpleButton>
          <PurpleButton onClick={start} disabled={!loaded || busy}>Start replay</PurpleButton>
        </div>
      </div>
    </div>
  );
}
