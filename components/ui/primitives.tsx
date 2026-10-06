import type { ReactNode } from "react";
import { LVL, type Level, type Tone } from "@/lib/ui/palette";

/** Small rounded status label. Colors come from the palette maps. */
export function StatusPill({ tone, children, className = "" }: { tone: Tone; children: ReactNode; className?: string }) {
  return <span className={`pill ${className}`} style={{ background: tone.bg, color: tone.fg }}>{children}</span>;
}

/** 44×24 switch. */
export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative h-6 w-11 rounded-pill border-0 p-0 transition-colors duration-200 ease-standard disabled:cursor-not-allowed"
      style={{ background: checked ? "var(--control-selected)" : "var(--control-unselected)", opacity: disabled ? 0.5 : 1 }}
    >
      <span className="absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-[left] duration-200 ease-standard" style={{ left: checked ? 23 : 3 }} />
    </button>
  );
}

export interface Kpi { label: string; value: ReactNode; sub: string; level: Level; muted?: boolean }

/** KPI tile: status dot and label, big number, sub-line. */
export function KpiTile({ kpi }: { kpi: Kpi }) {
  const c = kpi.muted ? { fg: "#5C5C6F", dot: "#BEBFC3" } : LVL[kpi.level];
  return (
    <div className="flex flex-col gap-1.5 rounded-16 bg-white px-[18px] py-4">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: c.dot }} />
        <span className="text-[13px] font-medium text-muted">{kpi.label}</span>
      </div>
      <span className="num text-[30px] font-semibold leading-[1.1] tracking-[-0.02em]" style={{ color: c.fg }}>{kpi.value}</span>
      <span className="text-xs text-muted">{kpi.sub}</span>
    </div>
  );
}

/** Page title for the review and detect screens: eyebrow over a purple H1. */
export function PageTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-base font-medium text-muted">{eyebrow}</span>
      <h1 className="m-0 text-4xl font-medium leading-[1.15] tracking-[-0.02em] text-purple">{title}</h1>
    </div>
  );
}

export function SearchIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 -960 960 960" fill="var(--purple)" aria-hidden="true">
      <path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z" />
    </svg>
  );
}
export function CloseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 -960 960 960" fill="var(--purple)" aria-hidden="true">
      <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" />
    </svg>
  );
}
