"use client";

import { type KeyboardEvent, useId, useMemo, useRef, useState } from "react";
import { splitAgent } from "@/lib/engine/format";
import { STATES } from "@/lib/engine/rules";
import type { AgentState } from "@/lib/types";

export interface PersonGroup { label: string; items: string[] }

interface Props {
  value: string;
  groups: PersonGroup[];
  onChange: (who: string) => void;
  /** Each person's current state, shown at the right end of their row and of the box. Omit for people without one. */
  states?: Record<string, AgentState> | null;
  /** Lets the caller load `states` only while the list is on screen. */
  onOpenChange?: (open: boolean) => void;
  "aria-label"?: string;
}

/** A long floor is searched, not scrolled: only the first matches are drawn. */
const MAX_SHOWN = 80;

function StateTag({ state }: { state: AgentState | undefined }) {
  const s = state && STATES[state];
  if (!s) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-medium text-ink">
      <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}
    </span>
  );
}

/**
 * The "View as" person box: type part of a name or a domain ID to narrow the list, then pick with
 * the mouse or the arrow keys and Enter. Escape or clicking away keeps the current person.
 */
export function PersonSearch({ value, groups, onChange, states, onOpenChange, ...aria }: Props) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpenState] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  // Closing clears what was typed, so the next opening starts from the whole list.
  const setOpen = (next: boolean) => { setOpenState(next); if (!next) setText(""); onOpenChange?.(next); };

  const q = text.trim().toLowerCase();
  const matches = useMemo(
    () => groups.flatMap(g => (q ? g.items.filter(p => p.toLowerCase().includes(q)) : g.items).map(name => ({ name, group: g.label }))),
    [groups, q],
  );
  const shown = matches.slice(0, MAX_SHOWN);
  const optionId = (i: number) => `${id}-${i}`;

  const show = () => { setActive(Math.max(0, shown.findIndex(m => m.name === value))); setOpen(true); };
  const close = () => { setOpen(false); inputRef.current?.blur(); };
  const pick = (name: string | undefined) => {
    close();
    if (name && name !== value) onChange(name);
  };
  const move = (i: number) => {
    const next = Math.max(0, Math.min(shown.length - 1, i));
    setActive(next);
    document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(active + 1), ArrowUp: () => move(active - 1), Enter: () => pick(shown[active]?.name), Escape: close,
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  };

  return (
    <div className="relative w-[340px] max-w-full">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-purple">
        <circle cx="6" cy="6" r="4.2" stroke="currentColor" strokeWidth="1.6" />
        <path d="m9.2 9.2 3.3 3.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef} type="text" role="combobox" aria-expanded={open} aria-controls={open ? id : undefined} aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? optionId(active) : undefined} aria-label={aria["aria-label"]}
        autoComplete="off" spellCheck={false} placeholder={open ? "Search name or ID" : undefined}
        value={open ? text : value} title={open ? undefined : value}
        onFocus={show} onBlur={() => setOpen(false)} onKeyDown={onKeyDown}
        onChange={e => { setText(e.target.value); setActive(0); }}
        className={`h-9 w-full truncate rounded-8 border bg-white pl-8 text-sm text-ink outline-none transition-colors duration-200 ease-standard placeholder:text-muted ${open ? "border-purple pr-3" : "border-line pr-[116px]"}`}
      />
      {!open && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"><StateTag state={states?.[value]} /></span>}
      {open && (
        <div
          id={id} role="listbox" aria-label={aria["aria-label"]}
          // Keeps focus in the box, which owns the keyboard.
          onMouseDown={e => e.preventDefault()}
          className="absolute left-0 top-[calc(100%+4px)] z-[110] max-h-[min(420px,calc(100vh-180px))] w-[max(100%,420px)] max-w-[calc(100vw-32px)] overflow-auto rounded-8 border border-purple bg-white pb-1 font-brand text-sm text-ink shadow-[0_12px_32px_rgba(35,30,51,0.16)] [scrollbar-color:var(--primary-500)_transparent] [scrollbar-width:thin]"
        >
          {shown.map((m, i) => {
            const { who, id: domain } = splitAgent(m.name);
            return (
              <div key={m.name}>
                {m.group !== shown[i - 1]?.group && <div className="truncate px-3 pb-1 pt-2.5 font-ui text-[11px] font-semibold uppercase tracking-[0.04em] text-muted">{m.group}</div>}
                <div
                  id={optionId(i)} role="option" aria-selected={m.name === value}
                  onMouseEnter={() => setActive(i)} onClick={() => pick(m.name)}
                  className={`flex cursor-pointer items-center justify-between gap-4 px-3 py-1.5 ${i === active ? "bg-pale-purple" : ""}`}
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className={`truncate ${m.name === value ? "font-semibold text-purple" : ""}`}>{who}</span>
                    {domain && <span className="num shrink-0 text-[11px] text-muted">{domain}</span>}
                  </span>
                  <StateTag state={states?.[m.name]} />
                </div>
              </div>
            );
          })}
          {shown.length === 0 && <div className="px-3 py-3 text-[13px] text-muted">No one matches “{text.trim()}”.</div>}
          {matches.length > shown.length && <div className="px-3 pb-1 pt-2 text-xs text-muted">Showing {shown.length} of {matches.length}. Keep typing to narrow it down.</div>}
        </div>
      )}
    </div>
  );
}
