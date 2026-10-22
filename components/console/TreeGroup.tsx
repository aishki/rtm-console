"use client";

import { type CSSProperties, useState } from "react";
import { queueLevels, rollUp } from "@/lib/queueStats";
import type { TreeNode } from "@/lib/queueTree";
import type { Agent, AgentState, QueueCounts, Rule } from "@/lib/types";
import { LVL } from "@/lib/ui/palette";
import { AgentCard } from "./AgentCard";

const MIX: { label: string; states: AgentState[]; color: string }[] = [
  { label: "On call", states: ["oncall", "outb"], color: "#00BBBA" },
  { label: "avail", states: ["avail"], color: "#449E3C" },
  { label: "ACW", states: ["acw"], color: "#F2BC35" },
  { label: "aux", states: ["auxb", "auxp"], color: "#794CFF" },
  { label: "off", states: ["off"], color: "#929299" },
];
/** State → index into MIX, so a row's mix is one pass over its agents. */
const BUCKET = Object.fromEntries(MIX.flatMap((m, i) => m.states.map(s => [s, i]))) as Record<AgentState, number>;
/** An open queue draws this many cards before asking to show the rest. */
const CARD_LIMIT = 100;
const INDENT = 20;
const plural = (n: number, word: string) => `${n} ${word}${n !== 1 ? "s" : ""}`;

// Fixed columns so every row lines up at any depth: the indent widens the first column and the label
// gives up the room. Narrow panels drop the mix counts and keep the bar.
const COLS = "grid items-center gap-x-3 grid-cols-[var(--indent)_minmax(0,1fr)_repeat(4,52px)_120px] @[760px]:grid-cols-[var(--indent)_minmax(0,1fr)_repeat(4,52px)_252px_120px]";
const indent = (depth: number) => ({ "--indent": `${16 + depth * INDENT}px` }) as CSSProperties;

/** Column labels above the tree, on the same grid as the rows. */
export function TreeHeader() {
  return (
    <div className="@container">
      <div className={`${COLS} px-4 text-xs font-semibold text-muted`} style={indent(0)}>
        <span />
        <span />
        <span className="text-right">In queue</span>
        <span className="text-right">SL</span>
        <span className="text-right">ASA</span>
        <span className="text-right">Abn</span>
        <span className="hidden @[760px]:inline" />
        <span>Mix</span>
      </div>
    </div>
  );
}

interface Props {
  node: TreeNode;
  depth: number;
  agentsById: Map<number, Agent>;
  /** The agents to show after filtering, id → position in the chosen sort. */
  shownIds: Map<number, number>;
  /** Ids of the agents breaching a rule this tick, worked out once for the whole tree. */
  breaching: Set<number>;
  queues: Record<string, QueueCounts>;
  rules: Rule[];
  expanded: (node: TreeNode) => boolean;
  onToggle: (node: TreeNode) => void;
  query: string;
  showMetrics: boolean;
}

/**
 * One node of the agent grid's Tower → Sub-tower → LOB → Queue tree: its call numbers and state mix,
 * then, when open, its children or (for a queue) its agent cards. Towers draw as cards; deeper levels
 * are rows inside them. The caller passes a tree already pruned to the filter.
 */
export function TreeGroup(props: Props) {
  const { node, depth, agentsById, shownIds, breaching, queues, rules, expanded, onToggle, query, showMetrics } = props;
  const [showAll, setShowAll] = useState(false);
  const open = expanded(node);
  const isQueue = node.level === "queue";

  const all = node.agentIds.flatMap(id => agentsById.get(id) ?? []);
  const counts = MIX.map(() => 0);
  let breach = 0;
  for (const a of all) {
    counts[BUCKET[a.state]]++;
    if (breaching.has(a.id)) breach++;
  }
  const mix = MIX.map((m, i) => ({ ...m, n: counts[i] }));
  const sub = isQueue ? plural(all.length, "agent") : `${plural(node.queues.length, "queue")} · ${plural(all.length, "agent")} · ${breach} breaching`;

  const q = rollUp(node.queues.flatMap(name => queues[name] ?? []));
  const lv = q && queueLevels(q, rules);
  const cell = (text: string | null, level?: keyof typeof LVL) => text === null || !level
    ? <span className="num text-right text-sm font-semibold text-muted">—</span>
    : <span className="num text-right text-sm font-semibold" style={{ color: LVL[level].fg }}>{text}</span>;

  const shown = isQueue && open
    ? node.agentIds.filter(id => shownIds.has(id)).sort((a, b) => shownIds.get(a)! - shownIds.get(b)!).flatMap(id => agentsById.get(id) ?? [])
    : [];
  const cards = showAll ? shown : shown.slice(0, CARD_LIMIT);

  const row = (
    <button
      type="button" onClick={() => onToggle(node)} aria-expanded={open} style={indent(depth)}
      className={`${COLS} w-full border-0 px-4 py-2.5 text-left text-inherit ${depth === 0 ? "rounded-15" : "border-t border-solid border-pale-purple"} ${open && (depth === 0 || isQueue) ? "bg-tint" : "bg-white"}`}
    >
      <svg width="16" height="8" viewBox="0 0 16 8" fill="none" aria-hidden="true" className="justify-self-end transition-transform duration-200 ease-standard" style={{ transform: `rotate(${open ? 0 : -90}deg)` }}>
        <path d="M1 1l7 6 7-6" stroke="#303044" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span title={node.label} className={`truncate font-semibold text-purple ${depth === 0 ? "text-base" : "text-sm"}`}>{node.label}</span>
        <span title={sub} className={`truncate text-xs ${breach > 0 && !isQueue ? "text-error-text" : "text-muted"}`}>{sub}</span>
      </span>
      {cell(q && String(Math.round(q.cq)), lv?.cq)}
      {cell(q && q.sl !== null ? `${q.sl.toFixed(0)}%` : null, lv?.sl)}
      {cell(q && `${Math.round(q.asa)}s`, lv?.asa)}
      {cell(q && `${q.ab.toFixed(1)}%`, lv?.ab)}
      <span className="num hidden truncate text-xs text-muted @[760px]:inline">{mix.map(m => `${m.n} ${m.label}`).join(" · ")}</span>
      <span aria-hidden="true" className="flex h-2 overflow-hidden rounded-4 bg-row">
        {mix.map(m => <span key={m.label} className="h-full" style={{ width: `${all.length ? (m.n / all.length) * 100 : 0}%`, background: m.color }} />)}
      </span>
    </button>
  );

  const body = open && (isQueue ? (
    <div className="flex flex-col gap-2.5 pb-4 pr-4 pt-1" style={{ paddingLeft: 16 + (depth + 1) * INDENT }}>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5">
        {cards.map(a => <AgentCard key={a.id} agent={a} rules={rules} query={query} showMetrics={showMetrics} />)}
      </div>
      {cards.length < shown.length && (
        <button type="button" onClick={() => setShowAll(true)} className="h-8 self-start border-0 bg-transparent px-0 text-[13px] font-semibold text-purple hover:text-purple-hover">
          Show all {shown.length}
        </button>
      )}
    </div>
  ) : node.children.map(c => <TreeGroup key={c.key} {...props} node={c} depth={depth + 1} />));

  if (depth > 0) return <>{row}{body}</>;
  return <div className="@container overflow-hidden rounded-15 bg-white ring-card">{row}{body}</div>;
}
