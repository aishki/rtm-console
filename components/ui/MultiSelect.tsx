"use client";

import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

export interface MultiOption<T extends string = string> { value: T; label: string; /** Dot shown before the label. */ color?: string }

interface Props<T extends string> {
  /** Checked values. Empty means no filter. */
  value: T[];
  onChange: (value: T[]) => void;
  options: MultiOption<T>[];
  /** Trigger text and first row when nothing is checked, e.g. "Any state". */
  anyLabel: string;
  /** Trigger text for several checked values, e.g. n => `${n} states`. */
  countLabel: (n: number) => string;
  "aria-label"?: string;
  /** Size and skin of the trigger, e.g. "field h-10 px-3". */
  className?: string;
}

function Check({ on }: { on: boolean }) {
  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px]" style={{ background: on ? "var(--control-selected)" : "var(--control-unselected)" }}>
      <svg width="8" height="7" viewBox="0 0 8 7" fill="none" aria-hidden="true">
        <path d="M1 3.6 3 5.9 7 1.1" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/**
 * BITS select for picking several values: the list stays open while rows are ticked, and the first row
 * clears them all. Arrow keys move, Space or Enter ticks, Escape or a click outside closes.
 */
export function MultiSelect<T extends string>({ value, onChange, options, anyLabel, countLabel, className = "", ...aria }: Props<T>) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // Row 0 is the "any" row; option i sits at row i + 1.
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  // Kept in the options' order, whatever order they were ticked in.
  const toggle = (v: T) => onChange(options.map(o => o.value).filter(x => (x === v ? !value.includes(v) : value.includes(x))));
  const act = (row: number) => (row === 0 ? onChange([]) : toggle(options[row - 1].value));
  const move = (row: number) => setActive(Math.max(0, Math.min(options.length, row)));
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); }
      return;
    }
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(active + 1), ArrowUp: () => move(active - 1), Home: () => move(0), End: () => move(options.length),
      Enter: () => act(active), " ": () => act(active), Escape: () => setOpen(false),
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault(); e.stopPropagation();
    run();
  };

  const picked = options.filter(o => value.includes(o.value));
  const summary = picked.length === 0 ? anyLabel : picked.length === 1 ? picked[0].label : countLabel(picked.length);
  const row = (i: number, on: boolean, label: string, color?: string) => (
    <div
      key={i} id={`${id}-${i}`} role="option" aria-selected={on}
      onMouseEnter={() => setActive(i)} onClick={() => act(i)}
      className={`flex cursor-pointer items-center gap-2.5 whitespace-nowrap px-3 py-2 ${i === active ? "bg-pale-purple" : ""} ${on ? "font-semibold text-purple" : "text-ink"}`}
    >
      <Check on={on} />
      {color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />}
      {label}
    </div>
  );

  return (
    <div ref={rootRef} className="relative inline-flex max-w-full">
      <button
        type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined} aria-label={aria["aria-label"]}
        onClick={() => { setActive(0); setOpen(o => !o); }} onKeyDown={onKeyDown}
        className={`inline-flex items-center justify-between gap-2 text-left transition-colors duration-200 ease-standard ${open || picked.length ? "!border-purple" : ""} ${className}`}
      >
        {/* Every summary shares one grid cell, so the trigger keeps one width whatever is ticked. */}
        <span className="grid min-w-0">
          {[anyLabel, countLabel(options.length), ...options.map(o => o.label)].map(t => <span key={t} aria-hidden="true" className="invisible col-start-1 row-start-1 truncate">{t}</span>)}
          <span className="col-start-1 row-start-1 truncate">{summary}</span>
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className={`shrink-0 text-purple transition-transform duration-200 ease-standard ${open ? "rotate-180" : ""}`}>
          <path d="m2.2 4.3 3.8 3.8 3.8-3.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          id={id} role="listbox" aria-multiselectable="true" aria-label={aria["aria-label"]}
          // Keeps focus on the trigger, which owns the keyboard.
          onMouseDown={e => e.preventDefault()}
          className="absolute left-0 top-[calc(100%+4px)] z-[110] min-w-full overflow-auto rounded-8 border border-purple bg-white py-1 font-brand text-sm shadow-[0_12px_32px_rgba(35,30,51,0.16)]"
        >
          {row(0, picked.length === 0, anyLabel)}
          {options.map((o, i) => row(i + 1, value.includes(o.value), o.label, o.color))}
        </div>
      )}
    </div>
  );
}
