"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STATES, isBreach, strikesOf, thrOf } from "@/lib/engine/rules";
import { teamOf } from "@/lib/engine/scope";
import { api, attempt } from "@/lib/client/api";
import { usePerms } from "@/lib/client/hooks";
import { useConsole } from "@/lib/client/store";
import type { Agent, Instance } from "@/lib/types";
import { PurpleButton } from "@/components/ui/buttons";
import { type Kpi, KpiTile } from "@/components/ui/primitives";
import { AgentGridToolbar, type GridFilters, NO_FILTERS, type QuickKey } from "@/components/console/AgentGridToolbar";
import { IncidentTiles } from "@/components/console/IncidentTiles";
import { TeamGroup } from "@/components/console/TeamGroup";
import { TriggerCard } from "@/components/console/TriggerCard";

const FEED_SIZE = 40;
const plural = (n: number, word: string) => `${n} ${word}${n !== 1 ? "s" : ""}`;

function useKpis(): Kpi[] {
  const queue = useConsole(s => s.queue);
  const rules = useConsole(s => s.rules);
  const agents = useConsole(s => s.agents);
  const replay = useConsole(s => s.mode === "replay");
  return useMemo(() => {
    if (!rules.length) return [];
    const thr = (id: Parameters<typeof thrOf>[1]) => thrOf(rules, id);
    const count = (...states: Agent["state"][]) => agents.filter(a => states.includes(a.state)).length;
    const onCall = count("oncall"), avail = count("avail"), aux = count("auxb", "auxp"), off = count("off");
    const avgAht = agents.length ? Math.round(agents.reduce((s, a) => s + a.aht, 0) / agents.length) : 0;
    const avgAdh = agents.length ? agents.reduce((s, a) => s + a.adh, 0) / agents.length : 100;
    const noQueue = (label: string): Kpi => ({ label, value: "—", sub: replay ? "No queue data in this import" : "Waiting for queue data", level: "ok", muted: true });
    const q = queue;
    return [
      q ? { label: "Service level", value: q.sl.toFixed(0) + "%", sub: `Target ≥ ${thr("sl")}%`, level: q.sl < thr("sl") ? "crit" : q.sl < thr("sl") + 5 ? "warn" : "ok" } : noQueue("Service level"),
      q ? { label: "Calls in queue", value: Math.round(q.cq), sub: `Alert > ${thr("cq")}`, level: q.cq > thr("cq") ? "crit" : q.cq > thr("cq") - 3 ? "warn" : "ok" } : noQueue("Calls in queue"),
      q ? { label: "ASA", value: q.asa + "s", sub: "Rolling interval", level: q.asa > 45 ? "warn" : "ok" } : noQueue("ASA"),
      q ? { label: "Abandon", value: q.ab.toFixed(1) + "%", sub: `Alert > ${thr("aband")}%`, level: q.ab > thr("aband") ? "crit" : q.ab > thr("aband") - 1.5 ? "warn" : "ok" } : noQueue("Abandon"),
      { label: "Avg AHT", value: avgAht + "s", sub: "Your span", level: avgAht > 560 ? "warn" : "ok" },
      { label: "Adherence", value: avgAdh.toFixed(0) + "%", sub: "Span average", level: avgAdh < thr("adh") ? "crit" : avgAdh < thr("adh") + 3 ? "warn" : "ok" },
      { label: "Staffed", value: `${onCall + avail}/${agents.length}`, sub: `${onCall} on call · ${aux} aux · ${off} off`, level: off > 2 ? "crit" : aux > 5 ? "warn" : "ok" },
    ];
  }, [queue, rules, agents, replay]);
}

function AgentGrid() {
  const teams = useConsole(s => s.org);
  const agents = useConsole(s => s.agents);
  const rules = useConsole(s => s.rules);
  const [filters, setFilters] = useState<GridFilters>(NO_FILTERS);
  // Keys prefixed "f:" hold the expand state of the filtered view, kept apart from the unfiltered one.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses search from anywhere except inside a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT" && searchRef.current) { e.preventDefault(); searchRef.current.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const qn = filters.q.trim().toLowerCase();
  const { quick } = filters;
  const filtering = !!(qn || filters.team || filters.state || quick.breach || quick.strikes || quick.hold);
  const teamFilter = teams.some(t => t.team === filters.team) ? filters.team : "";

  const matches = (a: Agent) => {
    if (teamFilter && a.team !== teamFilter) return false;
    if (filters.state && a.state !== filters.state) return false;
    if (quick.breach && !isBreach(a, rules)) return false;
    if (quick.strikes && !strikesOf(a)) return false;
    if (quick.hold && !a.onHold) return false;
    if (qn) {
      const tl = teamOf(teams, a.team).tl;
      if (!(a.name.toLowerCase().includes(qn) || a.team.toLowerCase().includes(qn) || tl.toLowerCase().includes(qn))) return false;
    }
    return true;
  };
  const sorters: Partial<Record<GridFilters["sortBy"], (x: Agent, y: Agent) => number>> = {
    time: (x, y) => y.stTime - x.stTime, strikes: (x, y) => strikesOf(y) - strikesOf(x), name: (x, y) => x.name.localeCompare(y.name),
  };
  const keyOf = (team: string) => (filtering ? "f:" : "") + team;
  // Up to 4 teams start expanded; more start collapsed. Filtering forces matching groups open.
  const isOpen = (team: string) => expanded[keyOf(team)] ?? (filtering || teams.length <= 4);

  const groups = teams.flatMap(team => {
    const all = agents.filter(a => a.team === team.team);
    let shown = all.filter(matches);
    if (!shown.length) return [];
    const sorter = sorters[filters.sortBy];
    if (sorter) shown = [...shown].sort(sorter);
    return [{ team, all, shown }];
  });
  const shownCount = groups.reduce((n, g) => n + g.shown.length, 0);
  const setAll = (open: boolean) => setExpanded(ex => ({ ...ex, ...Object.fromEntries(groups.map(g => [keyOf(g.team.team), open])) }));
  const clear = () => {
    setFilters(f => ({ ...NO_FILTERS, sortBy: f.sortBy }));
    setExpanded(ex => Object.fromEntries(Object.entries(ex).filter(([k]) => !k.startsWith("f:"))));
  };

  const mgrs = [...new Set(teams.map(t => t.mgr))];
  const teamGroups = mgrs.map(m => {
    const ts = teams.filter(t => t.mgr === m);
    return { label: `${m} · ${ts[0].lob}`, items: ts.map(t => ({ value: t.team, label: `${t.team} (${agents.filter(a => a.team === t.team).length})` })) };
  });
  const quickCounts: Record<QuickKey, number> = {
    breach: agents.filter(a => isBreach(a, rules)).length, strikes: agents.filter(a => strikesOf(a) > 0).length, hold: agents.filter(a => a.onHold).length,
  };

  return (
    <div className="panel min-w-0 flex-[1_1_560px]">
      <div className="panel-head">
        <h2 className="panel-title">Agent grid</h2>
        <span className="panel-sub">{plural(teams.length, "team")} · {agents.length} agents</span>
        <div className="flex-1" />
        <div className="flex flex-wrap gap-3.5">
          {Object.values(STATES).map(s => (
            <span key={s.label} className="inline-flex items-center gap-1.5 text-xs text-muted"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</span>
          ))}
        </div>
      </div>
      <AgentGridToolbar
        filters={{ ...filters, team: teamFilter }} onChange={patch => setFilters(f => ({ ...f, ...patch }))} onClear={clear} searchRef={searchRef}
        teamGroups={teamGroups} teamCount={teams.length} quickCounts={quickCounts} filtering={filtering}
        resultText={filtering ? `Showing ${shownCount} of ${agents.length} agents in ${plural(groups.length, "team")}` : `${agents.length} agents · ${plural(teams.length, "team")}`}
        showExpandControls={groups.length > 1} onExpandAll={() => setAll(true)} onCollapseAll={() => setAll(false)}
      />
      <div className="flex flex-col gap-2.5 px-5 pb-5 pt-4">
        {groups.map(g => {
          const open = isOpen(g.team.team);
          return (
            <TeamGroup
              key={g.team.team} team={g.team} all={g.all} shown={g.shown} rules={rules} open={open} filtering={filtering} query={qn} showMetrics
              onToggle={() => setExpanded(ex => ({ ...ex, [keyOf(g.team.team)]: !open }))}
            />
          );
        })}
        {groups.length === 0 && (
          <div className="flex flex-col items-center gap-3.5 py-10 text-center text-muted">
            <span>{filtering ? (qn ? `No agents match “${filters.q.trim()}” with the current filters.` : "No agents match the current filters.") : "No agents in this view."}</span>
            {filtering && <PurpleButton variant="outline" onClick={clear}>Clear filters</PurpleButton>}
          </div>
        )}
      </div>
    </div>
  );
}

function TriggerFeed() {
  const ledger = useConsole(s => s.ledger);
  const toast = useConsole(s => s.toast);
  const alerts = useMemo(() => ledger.slice(0, FEED_SIZE), [ledger]);
  const onAck = useCallback((n: number) => { void attempt(api.ack(n)); }, []);
  // Stub: wire this to the incident-report form.
  const onDraft = useCallback((r: Instance) => toast("esc", `Incident draft · ${r.inc}`, `Pre-filled draft for ${r.agent} (${r.rule}) opened for review.`), [toast]);
  return (
    <div className="panel flex min-w-0 max-w-[440px] flex-[1_1_340px] flex-col pb-4">
      <div className="panel-head !flex-nowrap">
        <h2 className="panel-title">Trigger feed</h2>
        <span className="panel-sub">{alerts.filter(r => r.status === "open").length} open</span>
      </div>
      {/* The panel's own bottom padding keeps the scrolling cards and scrollbar off its rounded edge. */}
      <div className="flex max-h-[calc(100vh-336px)] min-h-[360px] flex-col gap-2.5 overflow-auto px-3.5 pt-3.5">
        {alerts.map(r => <TriggerCard key={r.n} alert={r} onAck={onAck} onDraft={onDraft} />)}
        {alerts.length === 0 && <div className="px-3 py-10 text-center leading-normal text-muted">No open triggers in your span. The floor is green.</div>}
      </div>
    </div>
  );
}

export default function ConsolePage() {
  const kpis = useKpis();
  const perms = usePerms();
  const incidents = useConsole(s => s.incidents);
  const agents = useConsole(s => s.agents);
  const org = useConsole(s => s.org);
  return (
    <section className="flex flex-col gap-6">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4">
        {kpis.map(k => <KpiTile key={k.label} kpi={k} />)}
      </div>
      {perms?.ir && incidents.length > 0 && <IncidentTiles incidents={incidents} agents={agents} org={org} />}
      <div className="flex flex-wrap items-start gap-6">
        <AgentGrid />
        <TriggerFeed />
      </div>
    </section>
  );
}
