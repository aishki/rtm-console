"use client";

import { clock } from "@/lib/engine/format";
import { ROLE_LABEL } from "@/lib/engine/rules";
import { enableAlerts, useAlertState } from "@/lib/client/alerts";
import { api, attempt } from "@/lib/client/api";
import { usePerms } from "@/lib/client/hooks";
import { useConsole } from "@/lib/client/store";
import { PurpleButton } from "@/components/ui/buttons";

/**
 * True once the feed has been silent for longer than the "Gencloud not responding" rule's
 * threshold (30 s by default). Shorter gaps are normal: the queue poll lands every 5 seconds.
 */
function useFeedDown(): boolean {
  const staleFor = useConsole(s => s.staleFor);
  const limit = useConsole(s => s.rules.find(r => r.id === "gnr")?.thr ?? 30);
  return staleFor > limit;
}

function useFeedPill() {
  const status = useConsole(s => s.status);
  const mode = useConsole(s => s.mode);
  const replay = useConsole(s => s.replay);
  const staleFor = useConsole(s => s.staleFor);
  const down = useFeedDown();
  const sim = useConsole(s => s.feed === "sim");
  const realNames = useConsole(s => s.realNames);
  const loading = useConsole(s => s.agentsLoading);
  if (status !== "ready") return { bg: "#F5F5F5", fg: "#5C5C6F", dot: "#929299", text: status === "unauthorized" ? "Not signed in" : "Connecting…" };
  if (mode === "replay" && replay) return { bg: "#EBE4FF", fg: "#5009B5", dot: "#5009B5", text: `Data replay · ${replay.agents} agents · ${replay.events} events${replay.done ? " · complete" : ""}` };
  if (down) return { bg: "#FDF3D7", fg: "#7A5300", dot: "#F2BC35", text: sim ? `Simulation · feed stale ${staleFor}s` : `Gencloud not responding · feed stale ${staleFor}s` };
  if (sim) return { bg: "#EBE4FF", fg: "#5009B5", dot: "#5009B5", text: realNames ? "Simulation · real names, invented activity" : "Simulation · sample floor" };
  if (loading) return { bg: "#D9F5F5", fg: "#028283", dot: "#00BBBA", text: "Live feed · loading agent states…", pulse: true };
  return { bg: "#D9F5F5", fg: "#028283", dot: "#00BBBA", text: "Live feed · Gencloud/NICE API" };
}

/**
 * Under the navbar: who you are viewing as and what that role covers, the desktop-alert opt-in, feed status and
 * shift clock. The developer controls (View as, data source, notification switches) live in the dev bar above.
 */
export function ContextBar() {
  const view = useConsole(s => s.view);
  const ready = useConsole(s => s.status === "ready");
  const t = useConsole(s => s.t);
  const isReplay = useConsole(s => s.mode === "replay");
  const toast = useConsole(s => s.toast);
  const perms = usePerms();
  const feed = useFeedPill();
  const source = useConsole(s => s.feed);
  const feedDown = useFeedDown();
  // The usual cause of a silent Gencloud feed is an expired token; Admins get a shortcut to replace it.
  const gencloudDown = ready && !isReplay && source === "gencloud" && feedDown && view?.role === "admin";
  const alerts = useAlertState();
  const turnOnAlerts = async () => {
    const state = await enableAlerts();
    if (state === "granted") toast("info", "Desktop alerts are on", "Nudges and escalations will pop up on this computer, even with the browser minimized.");
    else if (state === "denied") toast("warn", "Desktop alerts are blocked", "Allow notifications for this site in the browser's site settings, then reload.");
  };

  return (
    <div className="flex min-h-[52px] flex-wrap items-center gap-x-4 gap-y-2 bg-white px-4 py-2.5 shadow-[inset_0_-1px_0_var(--border-hairline)] sm:px-8">
      {view && (
        <span className="inline-flex h-6 shrink-0 items-center rounded-pill bg-tint px-2.5 text-xs font-semibold text-purple-900">{ROLE_LABEL[view.role]}</span>
      )}
      <span className="text-pretty text-[13px] text-muted">{view && perms ? perms.desc(view.who) : ""}</span>
      <div className="flex-1" />
      {isReplay && perms?.replay && (
        <PurpleButton
          variant="outline" compact
          onClick={async () => { if (await attempt(api.exitReplay().then(() => true))) toast("info", "Back to the live feed", "Replay results were cleared."); }}
        >
          Exit replay
        </PurpleButton>
      )}
      {ready && alerts === "default" && (
        <PurpleButton variant="outline" compact onClick={() => void turnOnAlerts()}>
          <BellIcon />Enable desktop alerts
        </PurpleButton>
      )}
      {ready && alerts === "granted" && (
        <span className="hidden items-center gap-1.5 text-[13px] font-semibold text-success-text md:inline-flex"><BellIcon />Desktop alerts on</span>
      )}
      <span aria-hidden="true" className="hidden h-5 w-px bg-hairline md:block" />
      <div className="inline-flex h-8 items-center gap-2 rounded-pill px-3.5 text-[13px] font-semibold" style={{ background: feed.bg, color: feed.fg }}>
        <span className={`h-2 w-2 rounded-full ${"pulse" in feed && feed.pulse ? "animate-pulse" : ""}`} style={{ background: feed.dot }} />
        <span>{feed.text}</span>
        {gencloudDown && <a href="/admin/token" className="underline underline-offset-2">Refresh token</a>}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] text-muted">Shift clock</span>
        <span className="num text-base font-semibold">{ready ? clock(t) : "--:--:--"}</span>
      </div>
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.5a3.5 3.5 0 0 0-3.5 3.5v2.3L3.3 10.6h9.4L11.5 8.3V6A3.5 3.5 0 0 0 8 2.5ZM6.6 12.6a1.5 1.5 0 0 0 2.8 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
