"use client";

import { ROUTES } from "@/lib/engine/rules";
import { SEV } from "@/lib/ui/palette";
import type { Route, Rule, Severity } from "@/lib/types";
import { Toggle } from "@/components/ui/primitives";
import { Select, type SelectOption } from "@/components/ui/Select";

const SEVERITIES: SelectOption<Severity>[] = [{ value: "warn", label: "Warning" }, { value: "crit", label: "Critical" }];
const ROUTE_OPTIONS: SelectOption<Route>[] = ROUTES.map(([value, label]) => ({ value, label }));

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
        <Select
          value={r.sev} disabled={!canEdit} aria-label={`${r.name} severity`} onChange={v => onPatch(r, { sev: v })} options={SEVERITIES} detached
          className="h-[34px] rounded-pill border px-3 text-[13px] font-semibold" style={{ borderColor: sev.fg, background: sev.bg, color: sev.fg }}
        />
      </td>
      <td className="px-3.5 py-2.5">
        <Select value={r.route} disabled={!canEdit} aria-label={`${r.name} escalation route`} onChange={v => onPatch(r, { route: v })} options={ROUTE_OPTIONS} className="field h-[34px] px-2.5 text-[13px]" />
      </td>
      <td className="px-5 py-2.5"><Toggle checked={r.on} disabled={!canEdit} label={`Enable ${r.name}`} onChange={on => onPatch(r, { on })} /></td>
    </tr>
  );
}
