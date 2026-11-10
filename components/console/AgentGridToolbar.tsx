"use client";

import { type RefObject } from "react";
import { STATES, STATE_IDS } from "@/lib/engine/rules";
import type { AgentState } from "@/lib/types";
import { FilterChip, FilterClearIcon } from "@/components/ui/FilterChip";
import { type MultiOption, MultiSelect } from "@/components/ui/MultiSelect";
import { SearchBox } from "@/components/ui/SearchBox";
import { Select, type SelectOption } from "@/components/ui/Select";

export type SortBy = "state" | "team" | "time" | "strikes" | "name";
export type QuickKey = "breach" | "strikes" | "hold";
/**
 * `lobs` holds the ticked LOB keys and `queues` the ticked queue names; `states` the ticked states.
 * Each is empty for no filter.
 */
export interface GridFilters { q: string; lobs: string[]; queues: string[]; states: AgentState[]; quick: Partial<Record<QuickKey, boolean>>; sortBy: SortBy }
export const NO_FILTERS: GridFilters = { q: "", lobs: [], queues: [], states: [], quick: {}, sortBy: "state" };

/** One LOB in the filters (the Unmapped tower counts as one), with its queues. */
export interface LobGroup { key: string; label: string; items: { value: string; label: string }[] }

interface Props {
  filters: GridFilters;
  onChange: (patch: Partial<GridFilters>) => void;
  onClear: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
  /** Every LOB with its queues, in tree order. */
  queueGroups: LobGroup[];
  queueCount: number;
  quickCounts: Record<QuickKey, number>;
  filtering: boolean;
  resultText: string;
  showExpandControls: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

const QUICK: [QuickKey, string][] = [["breach", "Breaching now"], ["strikes", "Has strikes"], ["hold", "On hold"]];
const STATE_OPTIONS: MultiOption<AgentState>[] = STATE_IDS.map(id => ({ value: id, label: STATES[id].label, color: STATES[id].color }));
const SORT_OPTIONS: SelectOption<SortBy>[] = [
  { value: "state", label: "Sort: status, On Call first" },
  { value: "team", label: "Sort: roster order" },
  { value: "time", label: "Sort: longest in state" },
  { value: "strikes", label: "Sort: most strikes" },
  { value: "name", label: "Sort: name A–Z" },
];

/** Search, LOB/queue/state filters (each multi-pick), sort, quick-filter chips and the result line for the agent grid. */
export function AgentGridToolbar({ filters: f, onChange, onClear, searchRef, queueGroups, queueCount, quickCounts, filtering, resultText, showExpandControls, onExpandAll, onCollapseAll }: Props) {
  const select = "field h-10 max-w-full px-3";
  // The queue list shows only the ticked LOBs' queues, under a heading per LOB.
  const shownGroups = f.lobs.length ? queueGroups.filter(g => f.lobs.includes(g.key)) : queueGroups;
  const lobOptions: MultiOption[] = queueGroups.map(g => ({ value: g.key, label: `${g.label} (${g.items.length})` }));
  const queueOptions: MultiOption[] = shownGroups.flatMap(g => g.items.map(q => ({ ...q, group: g.label })));
  // Untick queues that leave the list when their LOB is unticked.
  const pickLobs = (lobs: string[]) => {
    const keep = new Set((lobs.length ? queueGroups.filter(g => lobs.includes(g.key)) : queueGroups).flatMap(g => g.items.map(q => q.value)));
    onChange({ lobs, queues: f.queues.filter(q => keep.has(q)) });
  };
  const textBtn = "h-8 border-0 bg-transparent px-2.5 text-[13px] font-semibold text-purple hover:text-purple-hover";
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-5 pb-1.5 pt-3.5">
        <SearchBox
          inputRef={searchRef} value={f.q} onChange={q => onChange({ q })} slashHint
          aria-label="Search agents" placeholder="Search agent, queue or Team Lead" className="min-w-[220px] flex-[1_1_280px]"
        />
        {queueGroups.length > 1 && (
          <MultiSelect value={f.lobs} onChange={pickLobs} options={lobOptions} anyLabel={`All LOBs (${queueGroups.length})`} countLabel={n => `${n} LOBs`} aria-label="Filter by LOB" className={`${select} !max-w-[240px]`} />
        )}
        {queueCount > 1 && (
          <MultiSelect
            value={f.queues} onChange={queues => onChange({ queues })} options={queueOptions}
            anyLabel={`All queues (${queueOptions.length})`} countLabel={n => `${n} queues`}
            aria-label="Filter by queue" className={`${select} !max-w-[240px]`}
          />
        )}
        <MultiSelect value={f.states} onChange={states => onChange({ states })} options={STATE_OPTIONS} anyLabel="Any state" countLabel={n => `${n} states`} aria-label="Filter by state" className={select} />
        <Select value={f.sortBy} onChange={sortBy => onChange({ sortBy })} options={SORT_OPTIONS} aria-label="Sort agents" className={select} />
      </div>
      {/* Compact chips, so the row stays on one line with the result count and Clear filters showing. */}
      <div className="flex flex-wrap items-center gap-x-4 border-b border-pale-purple px-5 pb-1.5">
        {QUICK.map(([k, label]) => (
          <FilterChip key={k} id={`qf-${k}`} label={`${label} (${quickCounts[k]})`} checked={!!f.quick[k]} compact onChange={on => onChange({ quick: { ...f.quick, [k]: on } })} />
        ))}
        <div className="flex-1" />
        <div className="flex flex-wrap items-center gap-3 py-2">
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
