"use client";

// TODO(prod): development only. Remove this bar (and lib/client/devSettings.ts) before production.
// ConsoleShell renders it only when DEV_TOOLS is true, so it shows in `next dev` and in builds made with NEXT_PUBLIC_DEV_TOOLS=1.

import { useEffect, useRef, useState } from "react";
import { ROLES } from "@/lib/engine/rules";
import { alertState, enableAlerts, pauseAlerts, syncAlerts, useAlertState } from "@/lib/client/alerts";
import { api, attempt } from "@/lib/client/api";
import { type DevSwitch, loadDevSettings, useDevSettings } from "@/lib/client/devSettings";
import { useConsole } from "@/lib/client/store";
import { ORGS, type OrgId, orgOf } from "@/lib/orgs";
import type { AgentState, Role } from "@/lib/types";
import { Select, type SelectOption } from "@/components/ui/Select";
import { PersonSearch } from "./PersonSearch";

const ROLE_OPTIONS: SelectOption<Role>[] = ROLES.map(([value, label]) => ({ value, label }));
/** Each Genesys org's live feed, then the simulator. */
const SOURCES: { org: OrgId | null; label: string; hint: string; dot: string }[] = [
  ...ORGS.map(o => ({ org: o.id, label: o.name.replace(/^Anthem /, ""), hint: `${o.name} · Genesys ${o.region}`, dot: "var(--turquoise)" })),
  { org: null, label: "Simulation", hint: "Invented activity", dot: "var(--light-purple)" },
];
const SWITCHES: { key: DevSwitch; label: string; hint: string }[] = [
  { key: "toasts", label: "Toasts", hint: "Toasts raised by the floor. Toasts from your own clicks still show." },
  { key: "nudges", label: "Nudge pop-ups", hint: "The agent's nudge pop-up." },
  { key: "desktop", label: "Desktop alerts", hint: "System notifications from this browser." },
];

const label = "font-medium text-[#B9AED6]";
// Inline switches and dividers need the full row; below 1536px the switches move into a menu (see NotificationMenu).
const divider = <span aria-hidden="true" className="hidden h-5 w-px bg-white/15 2xl:block" />;

/** A role and person to view the console as. Moved here from the context bar. */
function ViewAs() {
  const view = useConsole(s => s.view);
  const people = useConsole(s => s.people);
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
  if (!people || !view) return null;
  const states = !asAgent ? null : view.who && ownState ? { ...floorStates, [view.who]: ownState } : floorStates;
  const groups = view.role === "agent" ? people.agentsByTeam.map(g => ({ label: g.team, items: g.agents }))
    : view.role === "tl" ? [{ label: "Team Leads", items: people.tls }]
    : view.role === "mgr" ? [{ label: "Managers", items: people.mgrs }]
    : [];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={label}>View as</span>
      <Select
        value={view.role} onChange={role => void attempt(api.setView(role, null))} options={ROLE_OPTIONS} aria-label="View as role" detached
        className="h-7 rounded-8 border border-white/20 bg-white/10 px-3 text-xs font-semibold text-white hover:bg-white/15"
      />
      {groups.length > 0 && (
        <div className="w-[300px] max-w-full">
          <PersonSearch
            tone="dark" value={view.who ?? ""} aria-label="Person" groups={groups} states={states} onOpenChange={setPicking}
            onChange={who => void attempt(api.setView(view.role, who))}
          />
        </div>
      )}
    </div>
  );
}

/** A Genesys org's live feed or the simulator, for everyone on this server. Only an Admin may switch it. */
function DataSource() {
  const ready = useConsole(s => s.status === "ready");
  const source = useConsole(s => s.feed);
  const shown = useConsole(s => s.genesysOrg);
  const canSwitch = useConsole(s => s.canSwitchFeed);
  const isReplay = useConsole(s => s.mode === "replay");
  const toast = useConsole(s => s.toast);
  if (!ready || isReplay || source === "csv") return null;
  const isOn = (org: OrgId | null) => (org ? source === "gencloud" && shown === org : source === "sim");
  const pick = async (org: OrgId | null) => {
    if (isOn(org)) return;
    const res = await attempt(org ? api.setFeed("gencloud", org) : api.setFeed("sim"));
    if (!res) return;
    if (res.genesysOrg) {
      const o = orgOf(res.genesysOrg);
      toast("info", `Live feed: ${o.name}`, `Genesys ${o.region}.${source === "sim" ? " The simulation was cleared." : ""} The first time, agent states take a few minutes to load.`);
    } else if (res.realNames) toast("info", "Simulation is on", "Team and agent names are real. Every state change, call-out and incident is invented.");
    else toast("info", "Simulation is on", "No Genesys roster was available, so the sample teams and names are in use.");
  };
  return (
    <div className="flex items-center gap-2">
      <span className={label}>Data</span>
      <div
        role="radiogroup" aria-label="Data source" title={canSwitch ? undefined : "Only an Admin can switch the data source. View as Admin first."}
        className="inline-flex rounded-pill bg-white/10 p-0.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]"
      >
        {SOURCES.map(s => {
          const on = isOn(s.org);
          return (
            <button
              key={s.org ?? "sim"} type="button" role="radio" aria-checked={on} title={s.hint} disabled={!canSwitch && !on} onClick={() => void pick(s.org)}
              className={`inline-flex h-6 items-center gap-1.5 rounded-pill px-3 font-semibold transition-colors duration-200 ease-standard disabled:cursor-not-allowed disabled:opacity-50 ${on ? "bg-white text-purple-900" : "text-[#D9D2EE] enabled:hover:bg-white/10"}`}
            >
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: on ? s.dot : "rgba(255,255,255,0.35)" }} />
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** One on/off switch on the dark bar. */
function Switch({ on, label: text, hint, onClick }: { on: boolean; label: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} title={hint} onClick={onClick} className="inline-flex h-7 items-center gap-[7px] font-semibold">
      <span className={`relative h-4 w-7 shrink-0 rounded-pill transition-colors duration-200 ease-standard ${on ? "bg-turquoise" : "bg-white/20"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-[left] duration-200 ease-standard ${on ? "left-3.5" : "left-0.5"}`} />
      </span>
      <span className={on ? "text-white" : "text-[#8F84AE] line-through decoration-[#8F84AE]/60"}>{text}</span>
    </button>
  );
}

/** The switches' current values, and how to change one (desktop alerts may need the browser's permission). */
function useSwitches() {
  const settings = useDevSettings();
  const toast = useConsole(s => s.toast);
  // Desktop alerts only count as on when the browser allows them too.
  const permission = useAlertState();
  const isOn = (key: DevSwitch) => settings[key] && (key !== "desktop" || permission === "granted");
  const change = async (key: DevSwitch, on: boolean) => {
    if (on === isOn(key)) return;
    if (key !== "desktop") return settings.set(key, on);
    if (!on) { settings.set("desktop", false); await pauseAlerts().catch(() => {}); return; }
    const state = alertState() === "default" ? await enableAlerts() : alertState();
    if (state === "denied") { toast("warn", "Desktop alerts are blocked", "Allow notifications for this site in the browser's site settings, then reload."); return; }
    if (state === "unsupported") { toast("warn", "Desktop alerts are not available", "This browser cannot show system notifications."); return; }
    settings.set("desktop", true);
    await syncAlerts().catch(() => {});
  };
  return { isOn, change };
}

/** 1536px and wider: the switches sit in the bar and take effect at once. */
function NotificationSwitches() {
  const { isOn, change } = useSwitches();
  return (
    <div role="group" aria-label="Notifications" className="hidden flex-wrap items-center gap-x-3.5 gap-y-1 2xl:flex">
      <span className={label}>Notifications</span>
      {SWITCHES.map(s => <Switch key={s.key} on={isOn(s.key)} label={s.label} hint={s.hint} onClick={() => void change(s.key, !isOn(s.key))} />)}
    </div>
  );
}

/**
 * Below 1536px: a "Modify notifications" button opens a panel with the switches. Changes apply on Save;
 * Cancel, Escape or clicking outside drops them.
 */
function NotificationMenu() {
  const { isOn, change } = useSwitches();
  const [draft, setDraft] = useState<Record<DevSwitch, boolean> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const open = draft !== null;
  const onCount = SWITCHES.filter(s => isOn(s.key)).length;

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setDraft(null); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setDraft(null); };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  const toggle = () => setDraft(open ? null : { toasts: isOn("toasts"), nudges: isOn("nudges"), desktop: isOn("desktop") });
  const save = async () => {
    if (!draft) return;
    setDraft(null);
    for (const s of SWITCHES) await change(s.key, draft[s.key]);
  };

  return (
    <div ref={boxRef} className="relative 2xl:hidden">
      <button
        type="button" aria-expanded={open} aria-haspopup="dialog" onClick={toggle}
        className="inline-flex h-7 items-center gap-2 rounded-8 bg-white/10 px-3 font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)] transition-colors duration-200 ease-standard hover:bg-white/15"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 2.5a3.5 3.5 0 0 0-3.5 3.5v2.3L3.3 10.6h9.4L11.5 8.3V6A3.5 3.5 0 0 0 8 2.5ZM6.6 12.6a1.5 1.5 0 0 0 2.8 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Modify notifications
        <span className="num rounded-pill bg-white/15 px-1.5 text-[11px] text-[#D9D2EE]">{onCount}/{SWITCHES.length}</span>
      </button>
      {draft && (
        <div
          role="dialog" aria-label="Notifications"
          className="absolute left-0 top-[calc(100%+8px)] z-[120] flex w-[260px] flex-col gap-1 rounded-15 bg-[#24124A] p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14),0_16px_40px_rgba(0,0,0,0.35)]"
        >
          <span className={`${label} pb-1`}>Notifications</span>
          {SWITCHES.map(s => (
            <Switch key={s.key} on={draft[s.key]} label={s.label} hint={s.hint} onClick={() => setDraft({ ...draft, [s.key]: !draft[s.key] })} />
          ))}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)} className="h-8 rounded-20 px-3.5 font-semibold text-[#D9D2EE] hover:bg-white/10">Cancel</button>
            <button type="button" onClick={() => void save()} className="h-8 rounded-20 bg-white px-4 font-semibold text-purple-900 hover:bg-primary-300">Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The dark strip above the navbar with the developer controls: View as, the data source and the
 * notification switches. The striped bottom edge marks it as not part of the product.
 */
export function DevBar() {
  useEffect(loadDevSettings, []);
  return (
    // Same padding at every width (the bottom leaves room for the striped edge), so a wrapped bar still looks even.
    <div className="relative flex min-h-12 flex-wrap items-center gap-x-5 gap-y-2 bg-[#1A0D35] px-4 pb-3 pt-2 font-ui text-xs text-white sm:px-8">
      <span title="Development only · removed in production" className="inline-flex h-6 items-center gap-2 rounded-pill bg-warning/15 pl-2 pr-2.5 text-[11px] font-bold tracking-[0.08em] text-warning shadow-[inset_0_0_0_1px_rgba(242,188,53,0.45)]">
        <span className="h-[7px] w-[7px] rounded-full bg-warning motion-safe:animate-pulse" />DEV BUILD
      </span>
      {divider}
      <ViewAs />
      {divider}
      <DataSource />
      {divider}
      <NotificationSwitches />
      <NotificationMenu />
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 bg-[repeating-linear-gradient(-45deg,var(--warning)_0_8px,#1A0D35_8px_16px)]" />
    </div>
  );
}
