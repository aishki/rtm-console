"use client";

import { ROUTES } from "@/lib/engine/rules";
import { SEV } from "@/lib/ui/palette";
import type { Route, Rule, Severity } from "@/lib/types";
import { Toggle } from "@/components/ui/primitives";

interface Props { rule: Rule; canEdit: boolean; onPatch: (rule: Rule, patch: Partial<Pick<Rule, "thr" | "sev" | "route" | "on">>) => void }

/** One rule in the Rules Engine table. Every control is disabled without rules-admin access. */
export function RuleRow({ rule: r, canEdit, onPatch }: Props) {
  const sev = SEV[r.sev];
  return (
    <tr className="border-b border-row" style={{ opacity: r.on ? 1 : 0.6 }}>
      <td className="whitespace-nowrap px-5 py-2.5 font-semibold">{r.name}</td>
      <td className="px-3.5 py-2.5"><span className="rounded-pill bg-page px-2.5 py-0.5 font-ui text-xs font-medium text-muted">{r.type}</span></td>
      <td className="px-3.5 py-2.5 text-strong">{r.cond}</td>
      <td className="whitespace-nowrap px-3.5 py-2.5">
        {/* Keyed by the saved value so the field resets to it after each save. */}
        <input
          key={r.thr} type="number" min={1} defaultValue={r.thr} disabled={!canEdit} aria-label={`${r.name} threshold`}
          onBlur={e => { const v = Math.max(1, parseInt(e.target.value, 10) || r.thr); if (v !== r.thr) onPatch(r, { thr: v }); else e.target.value = String(r.thr); }}
          onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
          className="field h-[34px] w-20 px-2.5 font-ui"
        />
        <span className="ml-1.5 font-ui text-xs text-muted">{r.unit}</span>
      </td>
      <td className="px-3.5 py-2.5">
        <select
          value={r.sev} disabled={!canEdit} aria-label={`${r.name} severity`} onChange={e => onPatch(r, { sev: e.target.value as Severity })}
          className="h-[34px] rounded-pill border px-2.5 text-[13px] font-semibold disabled:cursor-not-allowed" style={{ borderColor: sev.fg, background: sev.bg, color: sev.fg }}
        >
          <option value="warn">Warning</option>
          <option value="crit">Critical</option>
        </select>
      </td>
      <td className="px-3.5 py-2.5">
        <select value={r.route} disabled={!canEdit} aria-label={`${r.name} escalation route`} onChange={e => onPatch(r, { route: e.target.value as Route })} className="field h-[34px] px-2.5 text-[13px]">
          {ROUTES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </td>
      <td className="px-5 py-2.5"><Toggle checked={r.on} disabled={!canEdit} label={`Enable ${r.name}`} onChange={on => onPatch(r, { on })} /></td>
    </tr>
  );
}
