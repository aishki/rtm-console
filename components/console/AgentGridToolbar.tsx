"use client";

import { type RefObject } from "react";
import { STATES, STATE_IDS } from "@/lib/engine/rules";
import type { AgentState } from "@/lib/types";
import { FilterChip, FilterClearIcon } from "@/components/ui/FilterChip";
import { CloseIcon, SearchIcon } from "@/components/ui/primitives";
import { Select, type SelectOption } from "@/components/ui/Select";

export type SortBy = "team" | "time" | "strikes" | "name";
export type QuickKey = "breach" | "strikes" | "hold";
export interface GridFilters { q: string; team: string; state: AgentState | ""; quick: Partial<Record<QuickKey, boolean>>; sortBy: SortBy }
export const NO_FILTERS: GridFilters = { q: "", team: "", state: "", quick: {}, sortBy: "team" };

interface Props {
  filters: GridFilters;
  onChange: (patch: Partial<GridFilters>) => void;
  onClear: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
  /** Team options grouped by "{Manager} · {LOB}". */
  teamGroups: { label: string; items: { value: string; label: string }[] }[];
  teamCount: number;
  quickCounts: Record<QuickKey, number>;
  filtering: boolean;
  resultText: string;
  showExpandControls: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

const QUICK: [QuickKey, string][] = [["breach", "Breaching now"], ["strikes", "Has strikes"], ["hold", "On hold"]];
const STATE_OPTIONS: SelectOption<AgentState | "">[] = [{ value: "", label: "Any state" }, ...STATE_IDS.map(id => ({ value: id, label: STATES[id].label }))];
const SORT_OPTIONS: SelectOption<SortBy>[] = [
  { value: "team", label: "Sort: roster order" },
  { value: "time", label: "Sort: longest in state" },
  { value: "strikes", label: "Sort: most strikes" },
  { value: "name", label: "Sort: name A–Z" },
];

/** Search, team/state/sort selects, quick-filter chips and the result line for the agent grid. */
export function AgentGridToolbar({ filters: f, onChange, onClear, searchRef, teamGroups, teamCount, quickCounts, filtering, resultText, showExpandControls, onExpandAll, onCollapseAll }: Props) {
  const select = "field h-10 max-w-full px-3";
  const textBtn = "h-8 border-0 bg-transparent px-2.5 text-[13px] font-semibold text-purple hover:text-purple-hover";
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-5 pb-1.5 pt-3.5">
        <div className="relative flex min-w-[220px] flex-[1_1_280px] items-center">
          <span className="pointer-events-none absolute left-3.5 flex"><SearchIcon /></span>
          <input
            ref={searchRef} type="search" value={f.q} aria-label="Search agents" placeholder="Search agent, team or Team Lead"
            onChange={e => onChange({ q: e.target.value })}
            onKeyDown={e => { if (e.key === "Escape") { onChange({ q: "" }); e.currentTarget.blur(); } }}
            className={`h-10 w-full rounded-20 border bg-white px-11 text-sm text-ink [&::-webkit-search-cancel-button]:hidden ${f.q ? "border-purple" : "border-line"}`}
          />
          {f.q ? (
            <button type="button" aria-label="Clear search" onClick={() => { onChange({ q: "" }); searchRef.current?.focus(); }} className="absolute right-1.5 flex h-[30px] w-[30px] items-center justify-center rounded-pill border-0 bg-tint">
              <CloseIcon />
            </button>
          ) : (
            <span title="Press / to search" className="pointer-events-none absolute right-3 flex h-[22px] min-w-[22px] items-center justify-center rounded-[6px] px-1.5 font-ui text-xs text-muted shadow-[inset_0_0_0_1px_var(--border-neutral)]">/</span>
          )}
        </div>
        {teamCount > 1 && (
          <Select value={f.team} onChange={team => onChange({ team })} options={[{ value: "", label: `All teams (${teamCount})` }, ...teamGroups]} aria-label="Filter by team" className={select} />
        )}
        <Select value={f.state} onChange={state => onChange({ state })} options={STATE_OPTIONS} aria-label="Filter by state" className={select} />
        <Select value={f.sortBy} onChange={sortBy => onChange({ sortBy })} options={SORT_OPTIONS} aria-label="Sort agents" className={select} />
      </div>
      <div className="flex flex-wrap items-center gap-x-5 border-b border-pale-purple pb-1.5 pl-[37px] pr-5">
        {QUICK.map(([k, label]) => (
          <FilterChip key={k} id={`qf-${k}`} label={`${label} (${quickCounts[k]})`} checked={!!f.quick[k]} onChange={on => onChange({ quick: { ...f.quick, [k]: on } })} />
        ))}
        <div className="flex-1" />
        <div className="flex flex-wrap items-center gap-4 py-2">
          <span aria-live="polite" className="text-[13px] text-muted">{resultText}</span>
          {filtering && (
            <button type="button" onClick={onClear} className="inline-flex h-8 items-center gap-1.5 rounded-pill border-0 bg-tint px-3 text-[13px] font-semibold text-purple">
              <FilterClearIcon size={18} active />Clear filters
            </button>
          )}
          {showExpandControls && (
            <div className="flex gap-1">
              <button type="button" onClick={onExpandAll} className={textBtn}>Expand all</button>
              <button type="button" onClick={onCollapseAll} className={textBtn}>Collapse all</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
