"use client";

import { useState } from "react";
import { type PageSlice, pageLabel, pageSlice } from "@/lib/paging";
import { Select } from "./Select";

/**
 * Paging state for a list. It goes back to page 1 whenever `resetKey` changes (a new filter or
 * search), and a list that shrinks keeps the viewer on its last page rather than an empty one.
 */
export function usePaged<T>(rows: T[], initialSize: number, resetKey: string) {
  const [state, setState] = useState({ page: 1, size: initialSize, key: resetKey });
  // Reset during render, not in an effect, so the first paint after a filter change is already page 1.
  if (state.key !== resetKey) setState(s => ({ ...s, page: 1, key: resetKey }));
  const page = state.key === resetKey ? state.page : 1;
  const slice = pageSlice(rows.length, page, state.size);
  return {
    rows: rows.slice(slice.from, slice.to),
    pager: {
      total: rows.length, slice, size: state.size,
      onPage: (p: number) => setState(s => ({ ...s, page: p })),
      onSize: (size: number) => setState(s => ({ ...s, size, page: 1 })),
    } satisfies PagerProps,
  };
}

export interface PagerProps {
  total: number;
  slice: PageSlice;
  size: number;
  onPage: (page: number) => void;
  /** Leave out to hide the page-size picker. */
  onSize?: (size: number) => void;
  sizes?: number[];
  /** What the rows are, for screen readers: "instances", "incidents", "agents". */
  noun?: string;
  className?: string;
}

/** "1–50 of 1,234" with previous and next, and a page-size picker. Nothing shows for a list that fits on one page at the smallest size. */
export function Pager({ total, slice, size, onPage, onSize, sizes = [25, 50, 100], noun = "rows", className = "" }: PagerProps) {
  if (total <= Math.min(size, ...(onSize ? sizes : [size]))) return null;
  const btn = "inline-flex h-8 w-8 items-center justify-center rounded-pill border-0 bg-transparent text-purple transition-colors duration-200 ease-standard enabled:hover:bg-tint disabled:cursor-not-allowed disabled:text-muted disabled:opacity-40";
  return (
    <nav aria-label={`Pages of ${noun}`} className={`flex flex-wrap items-center gap-3 text-[13px] text-muted ${className}`}>
      {onSize && (
        <label className="flex items-center gap-2">
          <span>Rows per page</span>
          <Select
            value={String(size)} onChange={v => onSize(Number(v))} options={sizes.map(s => ({ value: String(s), label: String(s) }))}
            aria-label="Rows per page" className="field h-8 px-2.5 text-[13px]"
          />
        </label>
      )}
      <span aria-live="polite" className="num">{pageLabel(total, slice)}</span>
      <span className="flex items-center gap-1">
        <button type="button" className={btn} disabled={slice.page <= 1} onClick={() => onPage(slice.page - 1)} aria-label="Previous page">
          <Chevron flip />
        </button>
        <span className="num min-w-[52px] text-center">{slice.page} / {slice.pages}</span>
        <button type="button" className={btn} disabled={slice.page >= slice.pages} onClick={() => onPage(slice.page + 1)} aria-label="Next page">
          <Chevron />
        </button>
      </span>
    </nav>
  );
}

function Chevron({ flip = false }: { flip?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={flip ? { transform: "rotate(180deg)" } : undefined}>
      <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
