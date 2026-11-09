"use client";

import { type RefObject, useRef } from "react";
import { CloseIcon, SearchIcon } from "@/components/ui/primitives";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  "aria-label": string;
  /** Lets the caller focus the box, e.g. on "/". */
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Shows the "/" key hint while the box is empty. */
  slashHint?: boolean;
  /** Width and flex of the wrapper, e.g. "min-w-[220px] flex-[1_1_280px]". */
  className?: string;
  /** Height of the box. */
  height?: string;
}

/** The agent grid's search bar: a round box with a clear button. Escape clears and leaves it. */
export function SearchBox({ value, onChange, placeholder, inputRef, slashHint = false, className = "", height = "h-10", ...aria }: Props) {
  const ownRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? ownRef;
  return (
    <div className={`relative flex items-center ${className}`}>
      <span className="pointer-events-none absolute left-3.5 flex"><SearchIcon /></span>
      <input
        ref={ref} type="search" value={value} aria-label={aria["aria-label"]} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === "Escape") { onChange(""); e.currentTarget.blur(); } }}
        className={`${height} w-full rounded-20 border bg-white px-11 text-sm text-ink [&::-webkit-search-cancel-button]:hidden ${value ? "border-purple" : "border-line"}`}
      />
      {value ? (
        <button type="button" aria-label="Clear search" onClick={() => { onChange(""); ref.current?.focus(); }} className="absolute right-1.5 flex h-[30px] w-[30px] items-center justify-center rounded-pill border-0 bg-tint">
          <CloseIcon />
        </button>
      ) : slashHint ? (
        <span title="Press / to search" className="pointer-events-none absolute right-3 flex h-[22px] min-w-[22px] items-center justify-center rounded-[6px] px-1.5 font-ui text-xs text-muted shadow-[inset_0_0_0_1px_var(--border-neutral)]">/</span>
      ) : null}
    </div>
  );
}

/** True when an agent's Genesys name ("Last, First - AH12345") contains the search, so it matches a name or a Domain ID. */
export const nameOrIdMatches = (name: string, query: string): boolean => {
  const q = query.trim().toLowerCase();
  return !q || name.toLowerCase().includes(q);
};
