"use client";

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { teamOf } from "@/lib/engine/scope";
import type { Agent, Incident, Team } from "@/lib/types";

/** Collapsed, the tiles show this many rows; the part-row peeking out at the bottom says there is more to scroll. */
const ROWS = 3.25;

/**
 * Height that shows ROWS rows of tiles, or null when everything fits. Tiles grow with their cause
 * text, so this measures the rendered rows instead of assuming a tile height.
 */
function measureCap(grid: HTMLElement): number | null {
  const tops: number[] = [];
  const heights = new Map<number, number>();
  for (const el of Array.from(grid.children) as HTMLElement[]) {
    if (!heights.has(el.offsetTop)) tops.push(el.offsetTop);
    heights.set(el.offsetTop, Math.max(heights.get(el.offsetTop) ?? 0, el.offsetHeight));
  }
  const whole = Math.floor(ROWS);
  if (tops.length <= whole) return null;
  const peek = tops[whole];
  return Math.round(peek + (ROWS - whole) * (heights.get(peek) ?? 0));
}

/** Agents with incident reports: one tile per agent, with why each incident was opened. */
export function IncidentTiles({ incidents, agents, org }: { incidents: Incident[]; agents: Agent[]; org: Team[] }) {
  const byAgent = new Map<string, Incident[]>();
  for (const i of incidents) byAgent.set(i.agent, [...(byAgent.get(i.agent) ?? []), i]);

  const panel = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [cap, setCap] = useState<number | null>(null);
  // Full height of the tiles. Expanded uses it as the max height (not "none"), so the height can animate.
  const [full, setFull] = useState(0);
  const [expanded, setExpanded] = useState(false);

  // Re-measure when tiles arrive, leave or wrap differently (the grid resizes in each case).
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const update = () => { setCap(measureCap(el)); setFull(el.offsetHeight); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Collapsing a long list can leave the reader far below the panel: once it has shrunk,
  // bring its header back into view, just under the sticky page header.
  const justCollapsed = useRef(false);
  useEffect(() => {
    if (expanded || !justCollapsed.current) return;
    justCollapsed.current = false;
    const top = panel.current?.getBoundingClientRect().top ?? 0;
    const below = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
    if (top < below) window.scrollBy({ top: top - below - 16, behavior: "smooth" });
  }, [expanded]);

  function toggle() {
    if (expanded) justCollapsed.current = true;
    setExpanded(!expanded);
  }

  // A click anywhere on the tiles toggles too (the bar below stays the keyboard control).
  // Selecting text or clicking a control inside a tile does not.
  function toggleFromTiles(e: MouseEvent) {
    if ((e.target as HTMLElement).closest("a, button, input, select, textarea")) return;
    if (window.getSelection()?.toString()) return;
    toggle();
  }

  return (
    <div ref={panel} className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Agents with incident reports</h2>
        <span className="panel-sub">Your span · why each incident was opened · {byAgent.size} agent{byAgent.size === 1 ? "" : "s"}</span>
      </div>
      {/* Collapsed, the list scrolls inside the panel so the agent grid below stays a short scroll away.
          Expanding and collapsing slide the height between the cap and the full list. */}
      <div
        id="incident-tiles"
        className={cap === null ? undefined : `panel-slide cursor-pointer ${expanded ? "overflow-hidden" : "overflow-y-auto"}`}
        style={cap === null ? undefined : { maxHeight: expanded ? full : cap }}
        onClick={cap === null ? undefined : toggleFromTiles}
        title={cap === null ? undefined : expanded ? "Click to collapse" : "Click to show all agents"}
      >
        <div ref={grid} className="relative grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 px-5 pb-5 pt-4">
          {[...byAgent].map(([name, list]) => {
            const t = teamOf(org, agents.find(a => a.name === name)?.team ?? list[0].team);
            const open = list.some(i => i.status !== "Closed");
            return (
              <div
                key={name}
                className={`flex min-w-0 flex-col gap-1.5 rounded-15 px-4 py-3.5 ${open ? "bg-error-fill shadow-[inset_0_0_0_1px_var(--error)]" : "bg-page opacity-75 shadow-[inset_0_0_0_1px_var(--neutral-300)]"}`}
              >
                {/* The count stays in the top-right corner, however many lines the name takes. */}
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 text-[15px] font-semibold [overflow-wrap:anywhere]">{name}</span>
                  <span className="shrink-0 whitespace-nowrap font-ui text-xs font-semibold text-error-text">{list.length} IR{list.length > 1 ? "s" : ""}{open ? "" : " · all closed"}</span>
                </div>
                {/* A long team name is cut with an ellipsis (full name on hover); the Team Lead always stays in view. */}
                <span className="flex min-w-0 text-xs text-muted">
                  <span className="truncate" title={t.team}>{t.team}</span>
                  <span className="shrink-0 whitespace-pre"> · TL {t.tl}</span>
                </span>
                <span className="text-pretty text-[13px] leading-normal">Cause: {list.map(i => `${i.rule} ×${i.instances}${i.status === "Closed" ? " (closed)" : ""}`).join(" · ")}</span>
              </div>
            );
          })}
        </div>
      </div>
      {/* A thin bar across the bottom of the panel toggles the list. It always sits right after the
          last tile you can see, so Collapse is in reach even at the end of a long expanded list. */}
      {cap !== null && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="incident-tiles"
          onClick={toggle}
          className="flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-b-[20px] border-t border-[var(--border-card)] font-ui text-xs font-semibold text-purple transition-colors duration-200 ease-standard hover:bg-[var(--surface-tint)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-purple"
        >
          {expanded ? "Collapse" : `Show all ${byAgent.size} agents`} <Chevron up={expanded} />
        </button>
      )}
    </div>
  );
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className={`transition-transform duration-200 ease-standard ${up ? "rotate-180" : ""}`}>
      <path d="m2.2 4.3 3.8 3.8 3.8-3.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
