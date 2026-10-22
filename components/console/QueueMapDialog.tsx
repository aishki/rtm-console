"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/client/api";
import type { QueueMapResult } from "@/lib/types";
import { PurpleButton } from "@/components/ui/buttons";

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const problems = (e: unknown) => (e instanceof ApiError ? e.details : [e instanceof Error ? e.message : "The mapping could not be uploaded."]);

/**
 * Upload the WFM queue-to-LOB workbook that groups the agent grid by tower, sub-tower, LOB and queue.
 * Admin only. The stream carries the new mapping to every console, so the grid regroups without a reload.
 */
export function QueueMapDialog({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<QueueMapResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    setResult(null);
    if (!/\.xlsx$/i.test(f.name)) { setFile(null); setErrors(["Upload the .xlsx file WFM sends."]); return; }
    setErrors([]);
    setFile(f);
  };

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try { setResult(await api.uploadQueueMap(file)); setErrors([]); setFile(null); }
    catch (e) { setErrors(problems(e)); }
    finally { setBusy(false); }
  };

  const hint = file ? `${file.name} is ready. Drop another file to replace it.` : "WFM queue-to-LOB workbook (.xlsx)";

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-auto bg-[rgba(35,30,51,0.5)] px-4 py-12">
      <div role="dialog" aria-modal="true" aria-label="Queue mapping" className="box-border flex w-[min(640px,100%)] flex-col gap-[18px] rounded-20 bg-white p-7">
        <div className="flex flex-col gap-2">
          <h2 className="m-0 text-2xl font-medium leading-normal tracking-[-0.02em] text-purple">Queue mapping</h2>
          <p className="m-0 text-pretty text-sm leading-[1.55] text-strong">
            Upload the workbook WFM sends. The agent grid groups queues by <b>tower, sub-tower and LOB</b> from its &ldquo;Queue-to-LOB mapping&rdquo; sheet (columns Tower, Sub-tower, LOB and Queue). An upload replaces the towers in the file and keeps every other tower. Queues not in the mapping show under Unmapped.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
            className={`flex flex-col gap-1.5 rounded-15 border-2 border-dashed p-7 text-center transition-colors duration-200 ease-standard ${drag ? "border-purple bg-tint" : "border-primary-500 bg-white"}`}
          >
            <span className="text-[15px] text-ink">Drop the file here, or <b className="text-purple">browse</b></span>
            <span className="text-xs text-muted">{busy ? "Uploading…" : hint}</span>
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={e => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        </div>

        {result && (
          <div className="flex flex-col gap-2">
            <span className="font-ui text-[13px] font-semibold text-turquoise-text">
              {count(result.queues, "queue")} stored · {result.towers.length ? `Replaced ${result.towers.join(", ")}` : "No towers replaced"}
            </span>
            {result.unmappedWatched.length > 0 && (
              <div className="flex flex-col gap-1 text-[13px] leading-normal text-strong">
                <span className="font-semibold">{count(result.unmappedWatched.length, "watched queue")} not in the mapping, shown under Unmapped</span>
                <ul className="m-0 flex max-h-[120px] list-disc flex-col gap-0.5 overflow-auto pl-5">{result.unmappedWatched.map(q => <li key={q}>{q}</li>)}</ul>
              </div>
            )}
            {result.skipped.length > 0 && (
              <div className="flex flex-col gap-1 text-[13px] leading-normal text-warning-text">
                <span className="font-semibold">{count(result.skipped.length, "row")} skipped</span>
                <ul className="m-0 flex max-h-[120px] list-disc flex-col gap-0.5 overflow-auto pl-5">{result.skipped.map(s => <li key={s.row}>Row {s.row}: {s.reason}</li>)}</ul>
              </div>
            )}
            {result.duplicates.length > 0 && (
              <div className="flex flex-col gap-1 text-[13px] leading-normal text-warning-text">
                <span className="font-semibold">{count(result.duplicates.length, "duplicate queue")}, first row kept</span>
                <ul className="m-0 flex max-h-[120px] list-disc flex-col gap-0.5 overflow-auto pl-5">
                  {result.duplicates.map((d, i) => <li key={`${d.queue}-${i}`}>{d.queue}: kept {d.kept}, dropped {d.dropped}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        {errors.length > 0 && (
          <ul role="alert" className={`m-0 flex flex-col gap-1 text-[13px] font-semibold leading-normal text-error-text ${errors.length > 1 ? "list-disc pl-5" : "list-none pl-0"}`}>
            {errors.map(e => <li key={e}>{e}</li>)}
          </ul>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2.5">
          <PurpleButton variant="outline" onClick={onClose}>{result ? "Done" : "Cancel"}</PurpleButton>
          <PurpleButton onClick={upload} disabled={!file || busy}>Upload</PurpleButton>
        </div>
      </div>
    </div>
  );
}
