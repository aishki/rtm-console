"use client";

import { type CSSProperties, type KeyboardEvent, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface SelectOption<T extends string = string> { value: T; label: string }
export interface SelectGroup<T extends string = string> { label: string; items: SelectOption<T>[] }

interface Props<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: (SelectOption<T> | SelectGroup<T>)[];
  "aria-label"?: string;
  disabled?: boolean;
  /** Size and skin of the trigger, e.g. "field h-10 px-3". */
  className?: string;
  style?: CSSProperties;
  /** For pill triggers: the menu floats 4px away with every corner rounded instead of joining the trigger. */
  detached?: boolean;
}

const MENU_MAX = 320;
const EDGE = 8;
const RADIUS = "8px";
const TYPEAHEAD_MS = 600;

/**
 * BITS select: a trigger sized to its widest option and a listbox that opens joined to it,
 * square where they meet and rounded at the far end. The list is portalled to the body so
 * tables, panels and dialogs that scroll cannot clip it.
 */
export function Select<T extends string>({ value, onChange, options, disabled = false, className = "", style, detached = false, ...aria }: Props<T>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const typed = useRef<{ text: string; timer?: ReturnType<typeof setTimeout> }>({ text: "" });

  const flat = options.flatMap(o => ("items" in o ? o.items : [o]));
  const indexOf = new Map(flat.map((o, i) => [o.value, i]));
  const selected = indexOf.get(value) ?? -1;
  const optionId = (i: number) => `${id}-${i}`;

  // Placed by hand, not through state: it has to follow the trigger on every scroll and resize.
  useLayoutEffect(() => {
    const btn = btnRef.current, menu = menuRef.current;
    if (!open || !btn || !menu) return;
    const corners = (el: HTMLElement, tl: string, tr: string, br: string, bl: string) => {
      Object.assign(el.style, { borderTopLeftRadius: tl, borderTopRightRadius: tr, borderBottomRightRadius: br, borderBottomLeftRadius: bl });
    };
    const place = () => {
      const r = btn.getBoundingClientRect();
      const gap = detached ? 4 : -1; // -1 lays the menu's border over the trigger's
      const below = window.innerHeight - r.bottom - EDGE, above = r.top - EDGE;
      const up = below < Math.min(menu.scrollHeight + 2, 200) && above > below;
      menu.style.fontSize = getComputedStyle(btn).fontSize;
      menu.style.minWidth = `${r.width}px`;
      menu.style.maxHeight = `${Math.max(96, Math.min(MENU_MAX, (up ? above : below) - gap))}px`;
      menu.style.left = `${Math.max(EDGE, Math.min(r.left, window.innerWidth - EDGE - menu.offsetWidth))}px`;
      menu.style.top = up ? "auto" : `${r.bottom + gap}px`;
      menu.style.bottom = up ? `${window.innerHeight - r.top + gap}px` : "auto";
      if (detached) corners(menu, RADIUS, RADIUS, RADIUS, RADIUS);
      else {
        // Where the menu is wider than the trigger, the corner that sticks out is rounded too.
        const jut = menu.offsetWidth > r.width + 1 ? RADIUS : "0";
        if (up) { corners(menu, RADIUS, RADIUS, jut, "0"); corners(btn, "0", "0", "", ""); }
        else { corners(menu, "0", jut, RADIUS, RADIUS); corners(btn, "", "", "0", "0"); }
      }
      menu.style.visibility = "visible";
    };
    const outside = (e: MouseEvent) => { if (!btn.contains(e.target as Node) && !menu.contains(e.target as Node)) setOpen(false); };
    place();
    menu.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    document.addEventListener("mousedown", outside);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("mousedown", outside);
      corners(btn, "", "", "", "");
    };
  }, [open, detached]);

  const show = () => { setActive(selected >= 0 ? selected : 0); setOpen(true); };
  const pick = (i: number) => {
    setOpen(false);
    if (flat[i] && flat[i].value !== value) onChange(flat[i].value);
  };
  const move = (i: number) => {
    const next = Math.max(0, Math.min(flat.length - 1, i));
    setActive(next);
    document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
  };
  /** Next option whose label starts with what was typed in the last 600ms. */
  const typeahead = (ch: string) => {
    clearTimeout(typed.current.timer);
    typed.current.text += ch.toLowerCase();
    typed.current.timer = setTimeout(() => { typed.current.text = ""; }, TYPEAHEAD_MS);
    const q = typed.current.text, from = open ? active : selected;
    const start = q.length === 1 ? from + 1 : Math.max(from, 0);
    for (let k = 0; k < flat.length; k++) {
      const i = (start + k) % flat.length;
      if (flat[i].label.toLowerCase().startsWith(q)) return i;
    }
    return -1;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const i = typeahead(e.key);
      if (i >= 0) { if (open) move(i); else pick(i); }
      return;
    }
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); show(); }
      return;
    }
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(active + 1), ArrowUp: () => move(active - 1), Home: () => move(0), End: () => move(flat.length - 1),
      Enter: () => pick(active), " ": () => pick(active), Escape: () => setOpen(false),
    };
    const run = keys[e.key];
    if (!run) return;
    // Stopped here so Escape closes the list only, not the dialog around it.
    e.preventDefault(); e.stopPropagation();
    run();
  };

  const option = (o: SelectOption<T>) => {
    const i = indexOf.get(o.value) ?? -1, isSelected = i === selected;
    return (
      <div
        key={o.value} id={optionId(i)} role="option" aria-selected={isSelected}
        onMouseEnter={() => setActive(i)} onClick={() => pick(i)}
        className={`flex cursor-pointer items-center justify-between gap-3 whitespace-nowrap px-3 py-2 ${i === active ? "bg-pale-purple" : ""} ${isSelected ? "font-semibold text-purple" : i === active ? "text-purple-900" : "text-ink"}`}
      >
        {o.label}
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className={isSelected ? "" : "invisible"}>
          <path d="m2.5 7.4 3 3 6-6.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  };

  return (
    <>
      <button
        ref={btnRef} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined} aria-label={aria["aria-label"]} disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKeyDown} onBlur={() => setOpen(false)}
        className={`inline-flex items-center justify-between gap-2 text-left transition-colors duration-200 ease-standard disabled:cursor-not-allowed disabled:opacity-60 ${open && !detached ? "!border-purple" : ""} ${className}`}
        style={style}
      >
        {/* Every label shares one grid cell, so the trigger is as wide as its longest option and never jumps. */}
        <span className="grid min-w-0">
          {flat.map(o => <span key={o.value} className={`col-start-1 row-start-1 truncate ${o.value === value ? "" : "invisible"}`}>{o.label}</span>)}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className={`shrink-0 transition-transform duration-200 ease-standard ${detached ? "" : "text-purple"} ${open ? "rotate-180" : ""}`}>
          <path d="m2.2 4.3 3.8 3.8 3.8-3.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && createPortal(
        <div
          ref={menuRef} id={id} role="listbox" aria-label={aria["aria-label"]}
          // Keeps focus on the trigger, which owns the keyboard.
          onMouseDown={e => e.preventDefault()} onClick={e => e.stopPropagation()}
          className="invisible fixed z-[110] overflow-auto [scrollbar-color:var(--primary-500)_transparent] [scrollbar-width:thin] border border-purple bg-white font-brand text-ink shadow-[0_12px_32px_rgba(35,30,51,0.16)]"
        >
          {options.map(o => "items" in o ? (
            <div key={o.label} role="group" aria-label={o.label}>
              <div className="px-3 pb-1 pt-2.5 font-ui text-[11px] font-semibold uppercase tracking-[0.04em] text-muted">{o.label}</div>
              {o.items.map(option)}
            </div>
          ) : option(o))}
        </div>,
        document.body,
      )}
    </>
  );
}
