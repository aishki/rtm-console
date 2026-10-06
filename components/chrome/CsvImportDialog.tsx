"use client";

import { useEffect, useRef, useState } from "react";
import { type CsvCols, type MappedState, buildEvents, distinctStatuses, guessCols, guessState, parseCSV, sampleCsv, splitTable } from "@/lib/csv/parse";
import { STATE_OPTIONS } from "@/lib/engine/rules";
import { api, downloadText } from "@/lib/client/api";
import { PurpleButton, TertiaryButton } from "@/components/ui/buttons";

interface Loaded { file: File; headers: string[]; rows: string[][]; cols: CsvCols; smap: Record<string, MappedState> }

const COLUMNS: { key: keyof CsvCols; label: string; required: boolean }[] = [
  { key: "agent", label: "Agent name", required: true },
  { key: "status", label: "Status / presence", required: true },
  { key: "start", label: "Start time", required: true },
  { key: "team", label: "Team", required: false },
];

/** Upload a Gencloud agent-status export, map its columns and statuses, and start a replay. */
export function CsvImportDialog({ onClose, onStarted }: { onClose: () => void; onStarted: () => void }) {
  const [csv, setCsv] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
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
    const all = parseCSV(await file.text());
    if (all.length < 2) { setError("Could not read the file: fewer than 2 rows found."); return; }
    const { headers, rows } = splitTable(all);
    setCsv({ file, headers, rows, cols: guessCols(headers), smap: {} });
    setError("");
  };

  const statuses = csv ? distinctStatuses(csv.rows, csv.cols.status) : [];
  const agentCount = csv ? new Set(csv.rows.map(r => (r[csv.cols.agent] || "").trim()).filter(Boolean)).size : 0;

  const start = async () => {
    if (!csv) return;
    const smap = Object.fromEntries(statuses.map(s => [s, csv.smap[s] || guessState(s)]));
    // Same check the server runs, so a bad mapping is reported before uploading.
    const res = buildEvents(csv.rows, csv.cols, smap);
    if ("error" in res) { setError(res.error); return; }
    setBusy(true);
    try { await api.startReplay(csv.file, csv.cols, smap); onStarted(); }
    catch (e) { setError(e instanceof Error ? e.message : "The replay could not be started."); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-auto bg-[rgba(35,30,51,0.5)] px-4 py-12">
      <div role="dialog" aria-modal="true" aria-label="Replay a Gencloud export" className="box-border flex w-[min(760px,100%)] flex-col gap-[18px] rounded-20 bg-white p-7">
        <div className="flex flex-col gap-2">
          <h2 className="m-0 text-2xl font-medium leading-normal tracking-[-0.02em] text-purple">Replay a Gencloud agent-status export</h2>
          <p className="m-0 text-pretty text-sm leading-[1.55] text-strong">
            Upload a CSV extracted from Genesys Cloud (agent status or presence detail). The console maps the statuses to its state model and <b>replays the day through the live rules engine</b> at 60×: every trigger, strike and incident your floor would have generated. Queue rules stay off during replay.
          </p>
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); void pick(e.dataTransfer.files[0]); }}
          className={`flex flex-col gap-1.5 rounded-15 border-2 border-dashed p-7 text-center transition-colors duration-200 ease-standard ${drag ? "border-purple bg-tint" : "border-primary-500 bg-white"}`}
        >
          <span className="text-[15px] text-ink">Drop the CSV here, or <b className="text-purple">browse</b></span>
          <span className="text-xs text-muted">{csv ? `${csv.rows.length} rows loaded. Drop another file to replace it.` : "One row per status change: agent, status, start time (team optional)"}</span>
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => { void pick(e.target.files?.[0]); e.target.value = ""; }} />

        {csv && (
          <div className="flex flex-col gap-2.5">
            <span className="text-sm font-semibold text-muted">Step 2 · Column mapping (auto-guessed, correct if needed)</span>
            {COLUMNS.map(c => (
              <label key={c.key} className="grid grid-cols-[200px_minmax(0,1fr)] items-center gap-3 text-sm">
                <span>{c.label} <span className={`text-xs font-semibold ${c.required ? "text-error-text" : "text-muted"}`}>{c.required ? "Required" : "Optional"}</span></span>
                <select value={csv.cols[c.key]} onChange={e => setCsv({ ...csv, cols: { ...csv.cols, [c.key]: Number(e.target.value) } })} className="field h-9 px-2.5">
                  {!c.required && <option value={-1}>None</option>}
                  {csv.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
              </label>
            ))}
            <span className="mt-2 text-sm font-semibold text-muted">Step 3 · Status mapping (Gencloud status to console state)</span>
            <div className="grid max-h-[220px] grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-x-5 gap-y-2 overflow-auto">
              {statuses.map(s => (
                <label key={s} className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-2.5">
                  <span className="truncate font-ui text-[13px] text-strong">{s}</span>
                  <select value={csv.smap[s] || guessState(s)} onChange={e => setCsv({ ...csv, smap: { ...csv.smap, [s]: e.target.value as MappedState } })} className="field h-[34px] px-2 text-[13px]">
                    {STATE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <span className="font-ui text-[13px] font-semibold text-turquoise-text">{csv.rows.length} rows · {agentCount} agents · {statuses.length} distinct statuses</span>
          </div>
        )}
        {error && <span role="alert" className="text-[13px] font-semibold text-error-text">{error}</span>}
        <div className="flex flex-wrap items-center gap-2.5">
          <TertiaryButton onClick={() => downloadText(sampleCsv(), "gencloud_agent_status_sample.csv")}>Download sample CSV</TertiaryButton>
          <div className="flex-1" />
          <PurpleButton variant="outline" onClick={onClose}>Cancel</PurpleButton>
          <PurpleButton onClick={start} disabled={!csv || busy}>Start replay</PurpleButton>
        </div>
      </div>
    </div>
  );
}
