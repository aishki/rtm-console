"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STATES, STATE_IDS, isBreach, strikesOf, thrOf } from "@/lib/engine/rules";
import { teamOf } from "@/lib/engine/scope";
import { api, attempt } from "@/lib/client/api";
import { usePerms } from "@/lib/client/hooks";
import { useConsole } from "@/lib/client/store";
import { queueLevels } from "@/lib/queueStats";
import { autoOpenQueues, expandAllKeys, filterTree, flatten } from "@/lib/gridFilter";
import { type TreeNode, buildTree } from "@/lib/queueTree";
import type { Agent, Instance } from "@/lib/types";
import { PurpleButton } from "@/components/ui/buttons";
import { type Kpi, KpiTile } from "@/components/ui/primitives";
import { AgentGridToolbar, type GridFilters, NO_FILTERS, type QuickKey } from "@/components/console/AgentGridToolbar";
import { IncidentTiles } from "@/components/console/IncidentTiles";
import { QueueMapDialog } from "@/components/console/QueueMapDialog";
import { TreeGroup, TreeHeader } from "@/components/console/TreeGroup";
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
    const q = queue, lv = q && queueLevels(q, rules);
    return [
      q && lv && q.sl !== null ? { label: "Service level", value: q.sl.toFixed(0) + "%", sub: `Target ≥ ${thr("sl")}%`, level: lv.sl }
        : q ? { label: "Service level", value: "—", sub: "No calls counted yet today", level: "ok", muted: true } : noQueue("Service level"),
      q && lv ? { label: "Calls in queue", value: Math.round(q.cq), sub: `Alert > ${thr("cq")}`, level: lv.cq } : noQueue("Calls in queue"),
      q && lv ? { label: "ASA", value: Math.round(q.asa) + "s", sub: "Rolling interval", level: lv.asa } : noQueue("ASA"),
      q && lv ? { label: "Abandon", value: q.ab.toFixed(1) + "%", sub: `Alert > ${thr("aband")}%`, level: lv.ab } : noQueue("Abandon"),
      { label: "Avg AHT", value: avgAht + "s", sub: "Your span", level: avgAht > 560 ? "warn" : "ok" },
      { label: "Adherence", value: avgAdh.toFixed(0) + "%", sub: "Span average", level: avgAdh < thr("adh") ? "crit" : avgAdh < thr("adh") + 3 ? "warn" : "ok" },
      { label: "Staffed", value: `${onCall + avail}/${agents.length}`, sub: `${onCall} on call · ${aux} aux · ${off} off`, level: off > 2 ? "crit" : aux > 5 ? "warn" : "ok" },
    ];
  }, [queue, rules, agents, replay]);
}

/** Queue filter options, one group per LOB (the Unmapped tower is one group). */
function queueOptions(tree: TreeNode[]) {
  const groups: { label: string; items: { value: string; label: string }[] }[] = [];
  const walk = (n: TreeNode, tower: string) => {
    const qs = n.children.filter(c => c.level === "queue");
    if (qs.length) groups.push({ label: n.level === "tower" ? n.label : `${tower} · ${n.label}`, items: qs.map(c => ({ value: c.label, label: `${c.label} (${c.agentIds.length})` })) });
    n.children.forEach(c => { if (c.level !== "queue") walk(c, tower); });
  };
  tree.forEach(t => walk(t, t.label));
  return groups;
}

function AgentGrid() {
  const org = useConsole(s => s.org);
  const agents = useConsole(s => s.agents);
  const rules = useConsole(s => s.rules);
  const loading = useConsole(s => s.agentsLoading);
  const queues = useConsole(s => s.queues);
  const members = useConsole(s => s.members);
  const queueMap = useConsole(s => s.queueMap);
  const perms = usePerms();
  const [filters, setFilters] = useState<GridFilters>(NO_FILTERS);
  // Keys prefixed "f:" hold the expand state of the filtered view, kept apart from the unfiltered one.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [mappingOpen, setMappingOpen] = useState(false);
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

  // Each team is a queue. A new org array arrives every tick, so the tree is keyed on the names alone:
  // members and the mapping change rarely, and rebuilding the tree per tick is too slow for big queues.
  const namesKey = JSON.stringify(org.map(t => t.team));
  const tree = useMemo(() => buildTree(JSON.parse(namesKey) as string[], queueMap, members), [namesKey, queueMap, members]);
  const queueGroups = useMemo(() => queueOptions(tree), [tree]);
  const agentsById = useMemo(() => new Map(agents.map(a => [a.id, a])), [agents]);
  // Once per tick, not once per queue membership: the same person sits in many queues.
  const breaching = useMemo(() => new Set(agents.filter(a => isBreach(a, rules)).map(a => a.id)), [agents, rules]);
  const queueCount = tree.reduce((n, t) => n + t.queues.length, 0);

  const qn = filters.q.trim().toLowerCase();
  const { quick } = filters;
  const queueFilter = tree.some(t => t.queues.includes(filters.queue)) ? filters.queue : "";
  const scoped = !!(filters.states.length || quick.breach || quick.strikes || quick.hold);
  const filtering = scoped || !!qn || !!queueFilter;

  const inScope = (a: Agent) => {
    if (filters.states.length && !filters.states.includes(a.state)) return false;
    if (quick.breach && !breaching.has(a.id)) return false;
    if (quick.strikes && !strikesOf(a)) return false;
    if (quick.hold && !a.onHold) return false;
    return true;
  };
  // A person matches on their name or team lead; queue membership stands in for their home team.
  const hits = (a: Agent) => a.name.toLowerCase().includes(qn) || teamOf(org, a.team).tl.toLowerCase().includes(qn);
  const view = filtering
    ? filterTree(tree, {
      query: qn, queue: queueFilter,
      inScope: scoped ? new Set(agents.filter(inScope).map(a => a.id)) : null,
      queryHits: new Set(qn ? agents.filter(hits).map(a => a.id) : []),
    })
    : null;
  const visible = view?.nodes ?? tree;
  const nodes = flatten(visible);

  // "state" follows the legend's order, On Call first; agents in the same state keep their roster order.
  const sorters: Partial<Record<GridFilters["sortBy"], (x: Agent, y: Agent) => number>> = {
    state: (x, y) => STATE_IDS.indexOf(x.state) - STATE_IDS.indexOf(y.state),
    time: (x, y) => y.stTime - x.stTime, strikes: (x, y) => strikesOf(y) - strikesOf(x), name: (x, y) => x.name.localeCompare(y.name),
  };
  const sorter = sorters[filters.sortBy];
  const order = new Map((sorter ? [...agents].sort(sorter) : agents).map((a, i) => [a.id, i]));

  const prefix = filtering ? "f:" : "";
  const keyOf = (node: TreeNode) => prefix + node.key;
  // Towers, sub-towers and LOBs start open and queues closed. A search also opens the queues it matches
  // while the result is small; a broad one, or a state, quick or queue filter alone, leaves them closed
  // showing counts, since it would draw thousands of cards. A node opened or closed by hand stays so.
  const autoOpen = view ? autoOpenQueues(view, qn) : new Set<string>();
  const isOpen = (node: TreeNode) => expanded[keyOf(node)] ?? (node.level !== "queue" || autoOpen.has(node.key));
  const toggle = (node: TreeNode) => setExpanded(ex => ({ ...ex, [keyOf(node)]: !isOpen(node) }));
  const expandAll = () => setExpanded(ex => ({ ...ex, ...Object.fromEntries(expandAllKeys(visible).map(k => [prefix + k, true])) }));
  const collapseAll = () => setExpanded(ex => ({ ...ex, ...Object.fromEntries(nodes.map(n => [keyOf(n), false])) }));
  const clear = () => {
    setFilters(f => ({ ...NO_FILTERS, sortBy: f.sortBy }));
    setExpanded(ex => Object.fromEntries(Object.entries(ex).filter(([k]) => !k.startsWith("f:"))));
  };

  const quickCounts: Record<QuickKey, number> = {
    breach: breaching.size, strikes: agents.filter(a => strikesOf(a) > 0).length, hold: agents.filter(a => a.onHold).length,
  };

  return (
    <div className="panel min-w-0 flex-[1_1_560px]">
      <div className="panel-head">
        <h2 className="panel-title">Agent grid</h2>
        <span className="panel-sub">{plural(tree.length, "tower")} · {plural(queueCount, "queue")} · {agents.length} agents</span>
        <div className="flex-1" />
        <div className="flex flex-wrap gap-3.5">
          {Object.values(STATES).map(s => (
            <span key={s.label} className="inline-flex items-center gap-1.5 text-xs text-muted"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</span>
          ))}
        </div>
        {perms?.mapping && <PurpleButton variant="outline" compact onClick={() => setMappingOpen(true)}>Queue mapping</PurpleButton>}
      </div>
      <AgentGridToolbar
        filters={{ ...filters, queue: queueFilter }} onChange={patch => setFilters(f => ({ ...f, ...patch }))} onClear={clear} searchRef={searchRef}
        queueGroups={queueGroups} queueCount={queueCount} quickCounts={quickCounts} filtering={filtering}
        resultText={view ? `${view.agentCount} of ${agents.length} agents · ${plural(view.queueCount, "queue")}` : `${agents.length} agents · ${plural(queueCount, "queue")}`}
        showExpandControls={nodes.length > 1} onExpandAll={expandAll} onCollapseAll={collapseAll}
      />
      {loading && (
        <div role="status" className="mx-5 mt-4 flex items-center gap-2.5 rounded-15 bg-warning-tint px-4 py-2.5 text-[13px] text-warning-text">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-warning" />
          <span><b className="font-semibold">Loading agent states from Genesys.</b> The roster shown is the last one saved; agents read “Loading state…” until their state arrives. This takes a few minutes after a restart.</span>
        </div>
      )}
      <div className="flex flex-col gap-2.5 px-5 pb-5 pt-4">
        {visible.length > 0 && <TreeHeader />}
        {visible.map(node => (
          <TreeGroup
            key={node.key} node={node} depth={0} agentsById={agentsById} shown={view?.shown ?? null} order={order} breaching={breaching} queues={queues} rules={rules}
            expanded={isOpen} onToggle={toggle} query={qn} showMetrics
          />
        ))}
        {visible.length === 0 && (
          <div className="flex flex-col items-center gap-3.5 py-10 text-center text-muted">
            <span>{filtering ? (qn ? `No agents match “${filters.q.trim()}” with the current filters.` : "No agents match the current filters.") : "No agents in this view."}</span>
            {filtering && <PurpleButton variant="outline" onClick={clear}>Clear filters</PurpleButton>}
          </div>
        )}
      </div>
      {mappingOpen && <QueueMapDialog onClose={() => setMappingOpen(false)} />}
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
