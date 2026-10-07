"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearAlert } from "@/lib/client/alerts";
import { api, attempt } from "@/lib/client/api";
import { useConsole } from "@/lib/client/store";
import type { NudgeEvent } from "@/lib/types";
import { PurpleButton } from "@/components/ui/buttons";
import { CarelonMark } from "@/components/ui/LogoLockup";

const DISMISS_MS = 14000;
const RECHECK_MS = 6000;

/**
 * The agent's private nudge, bottom-left. Agents see only their own; leaders see a preview
 * of what the associate got. It leaves by itself after 14s on screen, but never while being
 * typed in and never while the tab is in the background, where nobody could have read it.
 */
export function NudgePopup() {
  const nudge = useConsole(s => s.nudge);
  const role = useConsole(s => s.view?.role);
  const setNudge = useConsole(s => s.setNudge);
  const toast = useConsole(s => s.toast);
  const [draft, setDraft] = useState({ n: -1, text: "" });
  const focused = useRef(false);
  const reasonBox = useRef<HTMLTextAreaElement>(null);
  const wantsReason = useRef(false);
  const n = nudge?.n;
  // Closing here also takes down the desktop alert for the same nudge.
  const close = useCallback(() => { focused.current = false; if (n !== undefined) clearAlert(n); setNudge(null); }, [n, setNudge]);

  useEffect(() => {
    if (n === undefined) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const dismiss = () => { if (focused.current) timer = setTimeout(dismiss, RECHECK_MS); else close(); };
    const restart = () => { clearTimeout(timer); if (document.visibilityState === "visible") timer = setTimeout(dismiss, DISMISS_MS); };
    restart();
    document.addEventListener("visibilitychange", restart);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", restart); };
  }, [n, close]);

  // "Send reason" on a desktop alert lands here: show that nudge with the reason box ready.
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== "reason") return;
      wantsReason.current = true;
      setNudge(e.data.nudge as NudgeEvent);
      reasonBox.current?.focus();
    };
    sw.addEventListener("message", onMessage);
    sw.controller?.postMessage({ type: "reason?" });
    return () => sw.removeEventListener("message", onMessage);
  }, [setNudge]);
  useEffect(() => {
    if (n === undefined || !wantsReason.current) return;
    wantsReason.current = false;
    reasonBox.current?.focus();
  }, [n]);

  // Acknowledged somewhere else, e.g. "Got it" on the desktop alert.
  const acked = useConsole(s => !!s.nudge && s.ledger.some(r => r.n === s.nudge!.n && r.status === "acked"));
  useEffect(() => { if (acked) close(); }, [acked, close]);

  if (!nudge) return null;
  const isAgent = role === "agent";
  const text = draft.n === nudge.n ? draft.text : "";

  const gotIt = () => { void attempt(api.ack(nudge.n)); close(); };
  const sendReason = () => {
    const reason = text.trim();
    if (!reason) return gotIt();
    if (isAgent) {
      void attempt(api.comment(nudge.n, reason, true)).then(ok => { if (ok) toast("info", "Reason sent to your TL", "Logged on the instance. It shows in the TL feed, the ledger and exports."); });
    } else toast("info", "Preview only", "Only the associate can attach a reason to their own call-out. Nothing was saved.");
    close();
  };

  return (
    <div className="fixed bottom-6 left-6 z-[60] flex w-[360px] max-w-[calc(100vw-48px)] flex-col gap-2">
      {/* Floats over whatever the page has scrolled to, so it carries its own solid backing. */}
      <span className="self-start rounded-pill bg-[var(--dark-purple)] px-3 py-1 text-xs font-semibold text-white shadow-[0_4px_12px_rgba(35,30,51,0.22)]">{isAgent ? "Your screen · live nudge" : "Associate screen · nudge preview"}</span>
      <div role="dialog" aria-label="Nudge" className="flex flex-col gap-3 rounded-20 bg-white p-[18px] shadow-[var(--shadow-nudge)]">
        <div className="flex items-center gap-2.5">
          <CarelonMark size={28} alt="" />
          <span className="text-base font-semibold text-purple">{nudge.first}, quick heads up</span>
        </div>
        <p className="m-0 text-pretty text-sm leading-normal text-strong">{nudge.body}</p>
        <textarea
          ref={reasonBox}
          value={text}
          onChange={e => setDraft({ n: nudge.n, text: e.target.value })}
          onFocus={() => { focused.current = true; }}
          onBlur={() => { focused.current = false; }}
          maxLength={140}
          aria-label="Reason for your TL"
          placeholder="Optional: tell your TL why (complex case, member asked to hold)…"
          className="field min-h-14 resize-none px-3 py-2.5 text-[13px]"
        />
        <div className="flex flex-wrap gap-2">
          <PurpleButton compact onClick={gotIt}>Got it</PurpleButton>
          <PurpleButton compact variant="outline" onClick={close}>On a case, 2 min</PurpleButton>
          <PurpleButton compact variant="outline" onClick={sendReason}>Send reason</PurpleButton>
        </div>
      </div>
    </div>
  );
}
