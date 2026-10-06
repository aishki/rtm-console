"use client";

import { clock } from "@/lib/engine/format";
import { ROLES } from "@/lib/engine/rules";
import { api, attempt } from "@/lib/client/api";
import { usePerms } from "@/lib/client/hooks";
import { useConsole } from "@/lib/client/store";
import type { Role } from "@/lib/types";
import { PurpleButton } from "@/components/ui/buttons";
import { Select, type SelectOption } from "@/components/ui/Select";

const ROLE_OPTIONS: SelectOption<Role>[] = ROLES.map(([value, label]) => ({ value, label }));

function useFeedPill() {
  const status = useConsole(s => s.status);
  const mode = useConsole(s => s.mode);
  const replay = useConsole(s => s.replay);
  const staleFor = useConsole(s => s.staleFor);
  if (status !== "ready") return { bg: "#F5F5F5", fg: "#5C5C6F", dot: "#929299", text: status === "unauthorized" ? "Not signed in" : "Connecting…" };
  if (mode === "replay" && replay) return { bg: "#EBE4FF", fg: "#5009B5", dot: "#5009B5", text: `Data replay · ${replay.agents} agents · ${replay.events} events${replay.done ? " · complete" : ""}` };
  if (staleFor > 0) return { bg: "#FDF3D7", fg: "#7A5300", dot: "#F2BC35", text: `Gencloud not responding · feed stale ${staleFor}s` };
  return { bg: "#D9F5F5", fg: "#028283", dot: "#00BBBA", text: "Live feed · Gencloud/NICE API" };
}

/** Under the navbar: the "View as" selectors (dev flag), role description, feed status and shift clock. */
export function ContextBar() {
  const view = useConsole(s => s.view);
  const people = useConsole(s => s.people);
  const ready = useConsole(s => s.status === "ready");
  const t = useConsole(s => s.t);
  const isReplay = useConsole(s => s.mode === "replay");
  const toast = useConsole(s => s.toast);
  const perms = usePerms();
  const feed = useFeedPill();

  const groups = !people || !view ? []
    : view.role === "agent" ? people.agentsByTeam.map(g => ({ label: g.team, items: g.agents }))
    : view.role === "tl" ? [{ label: "Team Leads", items: people.tls }]
    : view.role === "mgr" ? [{ label: "Managers", items: people.mgrs }]
    : [];
  const select = "h-9 rounded-8 border bg-white px-3 text-sm text-ink";

  return (
    <div className="flex flex-wrap items-center gap-4 bg-white px-4 py-2.5 shadow-[inset_0_-1px_0_var(--border-hairline)] sm:px-8">
      {people && view && (
        <>
          <label className="flex items-center gap-2.5">
            <span className="text-[13px] font-semibold text-muted">View as</span>
            <Select value={view.role} onChange={role => void attempt(api.setView(role, null))} options={ROLE_OPTIONS} className={`${select} border-purple`} />
          </label>
          {groups.length > 0 && (
            <Select
              value={view.who ?? ""} aria-label="Person" onChange={who => void attempt(api.setView(view.role, who))} className={`${select} border-line`}
              options={groups.map(g => ({ label: g.label, items: g.items.map(p => ({ value: p, label: p })) }))}
            />
          )}
        </>
      )}
      <span className="text-pretty text-[13px] text-muted">{view && perms ? perms.desc(view.who) : ""}</span>
      <div className="flex-1" />
      {isReplay && perms?.replay && (
        <PurpleButton
          variant="outline"
          onClick={async () => { if (await attempt(api.exitReplay().then(() => true))) toast("info", "Back to the live feed", "Replay results were cleared."); }}
        >
          Exit replay
        </PurpleButton>
      )}
      <div className="inline-flex h-8 items-center gap-2 rounded-pill px-3.5 text-[13px] font-semibold" style={{ background: feed.bg, color: feed.fg }}>
        <span className="h-2 w-2 rounded-full" style={{ background: feed.dot }} />
        <span>{feed.text}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] text-muted">Shift clock</span>
        <span className="num text-base font-semibold">{ready ? clock(t) : "--:--:--"}</span>
      </div>
    </div>
  );
}
