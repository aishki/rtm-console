"use client";

import { useEffect, useState } from "react";
import { clock, splitAgent } from "@/lib/engine/format";
import { NOTE_MAX, ownerLabel } from "@/lib/engine/rules";
import type { Incident } from "@/lib/types";
import { PurpleButton } from "@/components/ui/buttons";

/** "notes": edit the investigation's notes. "close": add the closing note and close. "view": read both. */
export type NotesMode = "notes" | "close" | "view";

const TITLE: Record<NotesMode, string> = { notes: "Investigation notes", close: "Close incident", view: "Incident notes" };

/**
 * An incident's notes: kept while it is investigated, and a closing note when it closes. Saving
 * resolves to true when it went through, so the dialog closes only then.
 */
export function IncidentNotesDialog({ incident: i, mode, onClose, onSave }: {
  incident: Incident; mode: NotesMode; onClose: () => void; onSave: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState(mode === "notes" ? i.comments ?? "" : "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    setBusy(true);
    try { if (await onSave(text)) onClose(); } finally { setBusy(false); }
  };
  const { who } = splitAgent(i.agent);
  const label = "text-sm font-semibold text-purple-900";
  const readOnly = (t: string | undefined) => <p className="m-0 whitespace-pre-wrap rounded-15 bg-tint px-4 py-3 text-sm leading-[1.55] text-strong">{t || "None"}</p>;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-auto bg-[rgba(35,30,51,0.5)] px-4 py-12">
      <div role="dialog" aria-modal="true" aria-label={`${TITLE[mode]} ${i.inc}`} className="box-border flex w-[min(560px,100%)] flex-col gap-[18px] rounded-20 bg-white p-7">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-2xl font-medium leading-normal tracking-[-0.02em] text-purple">{TITLE[mode]}</h2>
          <p className="m-0 text-sm text-muted">
            {i.inc} · {who} · {i.rule} ×{i.instances}{i.owner && <> · Owner {ownerLabel(i.owner)}</>}{i.disposition && <> · {i.disposition}</>}
          </p>
        </div>

        {mode === "notes" && (
          <label className="flex flex-col gap-2">
            <span className={label}>Notes</span>
            <textarea
              value={text} onChange={e => setText(e.target.value)} rows={7} maxLength={NOTE_MAX} autoFocus
              placeholder="What has been checked, who was spoken to, what is still open"
              className="field resize-y px-3 py-2.5 text-sm"
            />
          </label>
        )}

        {mode === "close" && (
          <>
            {i.comments && <div className="flex flex-col gap-2"><span className={label}>Notes</span>{readOnly(i.comments)}</div>}
            <label className="flex flex-col gap-2">
              <span className={label}>Resolution <span className="font-normal text-muted">(optional)</span></span>
              <textarea
                value={text} onChange={e => setText(e.target.value)} rows={5} maxLength={NOTE_MAX} autoFocus
                placeholder="What was found and what was done"
                className="field resize-y px-3 py-2.5 text-sm"
              />
            </label>
          </>
        )}

        {mode === "view" && (
          <>
            <div className="flex flex-col gap-2"><span className={label}>Notes</span>{readOnly(i.comments)}</div>
            {i.status === "Closed" && (
              <div className="flex flex-col gap-2">
                <span className={label}>Resolution{i.closedT !== null && <span className="font-normal text-muted"> · closed {clock(i.closedT)}</span>}</span>
                {readOnly(i.resolution)}
              </div>
            )}
          </>
        )}

        <div className="flex flex-wrap justify-end gap-3">
          <PurpleButton variant="outline" onClick={onClose}>{mode === "view" ? "Close" : "Cancel"}</PurpleButton>
          {mode === "notes" && <PurpleButton onClick={() => void save()} disabled={busy || text.trim() === (i.comments ?? "")}>Save notes</PurpleButton>}
          {mode === "close" && <PurpleButton onClick={() => void save()} disabled={busy}>Close incident</PurpleButton>}
        </div>
      </div>
    </div>
  );
}
