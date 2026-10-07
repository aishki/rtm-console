"use client";

import { useEffect, useState } from "react";
import { clock } from "@/lib/engine/format";
import { ROLES } from "@/lib/engine/rules";
import { enableAlerts, useAlertState } from "@/lib/client/alerts";
import { api, attempt } from "@/lib/client/api";
import { usePerms } from "@/lib/client/hooks";
import { useConsole } from "@/lib/client/store";
import type { AgentState, FloorSource, Role } from "@/lib/types";
import { PurpleButton } from "@/components/ui/buttons";
import { Select, type SelectOption } from "@/components/ui/Select";
import { PersonSearch } from "./PersonSearch";

const ROLE_OPTIONS: SelectOption<Role>[] = ROLES.map(([value, label]) => ({ value, label }));
const SOURCE_OPTIONS: SelectOption<FloorSource>[] = [{ value: "gencloud", label: "Live Genesys" }, { value: "sim", label: "Simulation" }];

function useFeedPill() {
  const status = useConsole(s => s.status);
  const mode = useConsole(s => s.mode);
  const replay = useConsole(s => s.replay);
  const staleFor = useConsole(s => s.staleFor);
  const sim = useConsole(s => s.feed === "sim");
  const realNames = useConsole(s => s.realNames);
  if (status !== "ready") return { bg: "#F5F5F5", fg: "#5C5C6F", dot: "#929299", text: status === "unauthorized" ? "Not signed in" : "Connecting…" };
  if (mode === "replay" && replay) return { bg: "#EBE4FF", fg: "#5009B5", dot: "#5009B5", text: `Data replay · ${replay.agents} agents · ${replay.events} events${replay.done ? " · complete" : ""}` };
  if (staleFor > 0) return { bg: "#FDF3D7", fg: "#7A5300", dot: "#F2BC35", text: sim ? `Simulation · feed stale ${staleFor}s` : `Gencloud not responding · feed stale ${staleFor}s` };
  if (sim) return { bg: "#EBE4FF", fg: "#5009B5", dot: "#5009B5", text: realNames ? "Simulation · real names, invented activity" : "Simulation · sample floor" };
  return { bg: "#D9F5F5", fg: "#028283", dot: "#00BBBA", text: "Live feed · Gencloud/NICE API" };
}

/** Under the navbar: the "View as" selectors (dev flag), role description, data source switch (dev), feed status and shift clock. */
export function ContextBar() {
  const view = useConsole(s => s.view);
  const people = useConsole(s => s.people);
  const ready = useConsole(s => s.status === "ready");
  const t = useConsole(s => s.t);
  const isReplay = useConsole(s => s.mode === "replay");
  const toast = useConsole(s => s.toast);
  const perms = usePerms();
  const feed = useFeedPill();
  const source = useConsole(s => s.feed);
  const canSwitchFeed = useConsole(s => s.canSwitchFeed);
  const staleFor = useConsole(s => s.staleFor);
  // The usual cause of a silent Gencloud feed is an expired token; Admins get a shortcut to replace it.
  const gencloudDown = ready && !isReplay && source === "gencloud" && staleFor > 0 && view?.role === "admin";
  const switchFeed = async (to: FloorSource) => {
    const res = await attempt(api.setFeed(to));
    if (!res) return;
    if (res.feed !== "sim") toast("info", "Back to the live Genesys feed", "The simulation was cleared.");
    else if (res.realNames) toast("info", "Simulation is on", "Team and agent names are real. Every state change, call-out and incident is invented.");
    else toast("info", "Simulation is on", "No Genesys roster was available, so the sample teams and names are in use.");
  };
  const alerts = useAlertState();
  const turnOnAlerts = async () => {
    const state = await enableAlerts();
    if (state === "granted") toast("info", "Desktop alerts are on", "Nudges and escalations will pop up on this computer, even with the browser minimized.");
    else if (state === "denied") toast("warn", "Desktop alerts are blocked", "Allow notifications for this site in the browser's site settings, then reload.");
  };

  const groups = !people || !view ? []
    : view.role === "agent" ? people.agentsByTeam.map(g => ({ label: g.team, items: g.agents }))
    : view.role === "tl" ? [{ label: "Team Leads", items: people.tls }]
    : view.role === "mgr" ? [{ label: "Managers", items: people.mgrs }]
    : [];
  const select = "h-9 rounded-8 border bg-white px-3 text-sm text-ink";

  // Agent states for the person box: everyone's while its list is open, and the chosen agent's own from the live stream.
  const asAgent = view?.role === "agent";
  const [picking, setPicking] = useState(false);
  const [floorStates, setFloorStates] = useState<Record<string, AgentState> | null>(null);
  const ownState = useConsole(s => (s.view?.role === "agent" ? s.agents.find(a => a.name === s.view?.who)?.state : undefined));
  useEffect(() => {
    if (!asAgent || !picking) return;
    let live = true;
    const load = () => void api.peopleStates().then(r => { if (live) setFloorStates(r.states); }).catch(() => {});
    load();
    const timer = setInterval(load, 5000);
    return () => { live = false; clearInterval(timer); };
  }, [asAgent, picking]);
  const states = !asAgent ? null : view.who && ownState ? { ...floorStates, [view.who]: ownState } : floorStates;

  return (
    <div className="flex flex-wrap items-center gap-4 bg-white px-4 py-2.5 shadow-[inset_0_-1px_0_var(--border-hairline)] sm:px-8">
      {people && view && (
        <>
          <label className="flex items-center gap-2.5">
            <span className="text-[13px] font-semibold text-muted">View as</span>
            <Select value={view.role} onChange={role => void attempt(api.setView(role, null))} options={ROLE_OPTIONS} className={`${select} border-purple`} />
          </label>
          {groups.length > 0 && (
            <PersonSearch
              value={view.who ?? ""} aria-label="Person" groups={groups} states={states} onOpenChange={setPicking}
              onChange={who => void attempt(api.setView(view.role, who))}
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
      {ready && canSwitchFeed && !isReplay && source !== "csv" && (
        <label className="flex items-center gap-2.5">
          <span className="text-[13px] font-semibold text-muted">Data</span>
          <Select value={source} onChange={to => void switchFeed(to)} options={SOURCE_OPTIONS} className={`${select} border-line`} />
        </label>
      )}
      {ready && alerts === "default" && <PurpleButton variant="outline" onClick={() => void turnOnAlerts()}>Enable desktop alerts</PurpleButton>}
      <div className="inline-flex h-8 items-center gap-2 rounded-pill px-3.5 text-[13px] font-semibold" style={{ background: feed.bg, color: feed.fg }}>
        <span className="h-2 w-2 rounded-full" style={{ background: feed.dot }} />
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
