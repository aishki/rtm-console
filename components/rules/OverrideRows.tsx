"use client";

import { ROUTES } from "@/lib/engine/rules";
import { type OverridePatch, type PlaceLevel, levelOf, placeKey, placeLabel, ruleFor, samePlace } from "@/lib/engine/overrides";
import type { Place, Rule, RuleOverride } from "@/lib/types";
import { Select, type SelectGroup, type SelectOption } from "@/components/ui/Select";

const LEVEL: Record<PlaceLevel, string> = { tower: "Tower", subTower: "Sub-Tower", lob: "LOB" };
const SEV_LABEL = { warn: "Warning", crit: "Critical" } as const;
const routeLabel = (id: Rule["route"]) => ROUTES.find(r => r[0] === id)?.[1] ?? id;

interface Props {
  rule: Rule;
  canEdit: boolean;
  /** Every Tower, Sub-Tower and LOB in the queue mapping. */
  places: Place[];
  onPatch: (rule: Rule, place: Place, patch: OverridePatch) => void;
}

/** The rule as `o`'s place gets it from the levels above, without `o` itself. */
const inherited = (r: Rule, o: Place): Rule => ruleFor({ ...r, overrides: r.overrides?.filter(x => !samePlace(x, o)) }, o);

/**
 * A rule's overrides by Tower, Sub-Tower and LOB, under its row in the Rules Engine table. An empty
 * setting takes the value from the level above, which each control shows. Admins and Managers can add,
 * change and remove them; the last row adds one.
 */
export function OverrideRows({ rule: r, canEdit, places, onPatch }: Props) {
  if (r.type === "system") return null;
  const list = r.overrides ?? [];
  const free = places.filter(p => !list.some(o => samePlace(o, p)));
  return (
    <>
      {list.map(o => <OverrideRow key={placeKey(o)} rule={r} o={o} canEdit={canEdit} onPatch={onPatch} />)}
      {canEdit && free.length > 0 && <AddRow rule={r} free={free} onPatch={onPatch} />}
    </>
  );
}

function OverrideRow({ rule: r, o, canEdit, onPatch }: { rule: Rule; o: RuleOverride; canEdit: boolean; onPatch: Props["onPatch"] }) {
  const base = inherited(r, o);
  const set = (patch: OverridePatch) => onPatch(r, o, patch);
  const sevOptions: SelectOption<"" | Rule["sev"]>[] = [{ value: "", label: `Inherit (${SEV_LABEL[base.sev]})` }, { value: "warn", label: "Warning" }, { value: "crit", label: "Critical" }];
  const routeOptions: SelectOption<"" | Rule["route"]>[] = [{ value: "", label: `Inherit (${routeLabel(base.route)})` }, ...ROUTES.map(([value, label]) => ({ value, label }))];
  const onOptions: SelectOption<"" | "on" | "off">[] = [{ value: "", label: `Inherit (${base.on ? "On" : "Off"})` }, { value: "on", label: "On" }, { value: "off", label: "Off" }];
  const label = placeLabel(o);
  return (
    <tr className="border-b border-row bg-page" style={{ opacity: ruleFor(r, o).on ? 1 : 0.6 }}>
      <td className="px-5 py-2 pl-9 text-strong"><span aria-hidden className="mr-1.5 text-muted">↳</span>{label}</td>
      <td className="px-3.5 py-2"><span className="rounded-pill bg-tint px-2.5 py-0.5 font-ui text-xs font-medium text-purple-900">{LEVEL[levelOf(o)]}</span></td>
      <td className="px-3.5 py-2 text-xs text-muted">Empty settings come from {levelOf(o) === "tower" ? "the rule" : "the level above"}.</td>
      <td className="whitespace-nowrap px-3.5 py-2">
        {/* Keyed by the saved value so the field resets to it after each save. Empty inherits. */}
        <input
          key={o.thr ?? "inherit"} type="number" min={1} defaultValue={o.thr ?? ""} placeholder={String(base.thr)} disabled={!canEdit} aria-label={`${r.name} threshold for ${label}`}
          onBlur={e => {
            const raw = e.target.value.trim();
            const v = raw === "" ? null : Math.max(1, parseInt(raw, 10) || base.thr);
            if (v !== (o.thr ?? null)) set({ thr: v }); else e.target.value = o.thr === undefined ? "" : String(o.thr);
          }}
          onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
          className="field h-[34px] w-20 px-2.5 font-ui"
        />
        <span className="ml-1.5 font-ui text-xs text-muted">{r.unit}</span>
      </td>
      <td className="px-3.5 py-2">
        <Select value={o.sev ?? ""} disabled={!canEdit} aria-label={`${r.name} severity for ${label}`} onChange={v => set({ sev: v || null })} options={sevOptions} className="field h-[34px] px-2.5 text-[13px]" />
      </td>
      <td className="px-3.5 py-2">
        <Select value={o.route ?? ""} disabled={!canEdit} aria-label={`${r.name} escalation route for ${label}`} onChange={v => set({ route: v || null })} options={routeOptions} className="field h-[34px] px-2.5 text-[13px]" />
      </td>
      <td className="whitespace-nowrap px-5 py-2">
        <span className="inline-flex items-center gap-2">
          <Select value={o.on === undefined ? "" : o.on ? "on" : "off"} disabled={!canEdit} aria-label={`Enable ${r.name} for ${label}`} onChange={v => set({ on: v === "" ? null : v === "on" })} options={onOptions} className="field h-[34px] px-2.5 text-[13px]" />
          {canEdit && (
            <button
              type="button" aria-label={`Remove the ${label} override of ${r.name}`} title="Remove: this place goes back to the level above"
              onClick={() => set({ thr: null, sev: null, route: null, on: null })}
              className="rounded-8 px-1.5 py-1 text-lg leading-none text-muted transition-colors hover:bg-tint hover:text-purple"
            >×</button>
          )}
        </span>
      </td>
    </tr>
  );
}

function AddRow({ rule: r, free, onPatch }: { rule: Rule; free: Place[]; onPatch: Props["onPatch"] }) {
  // Grouped by Tower; each Sub-Tower and LOB is indented under the one above it.
  const groups = new Map<string, SelectOption[]>();
  for (const p of free) {
    const items = groups.get(p.tower) ?? [];
    const lvl = levelOf(p);
    items.push({ value: placeKey(p), label: lvl === "tower" ? `${p.tower} (whole Tower)` : lvl === "subTower" ? `${p.subTower} (whole Sub-Tower)` : ` ${p.subTower} › ${p.lob}` });
    groups.set(p.tower, items);
  }
  const options: (SelectOption | SelectGroup)[] = [{ value: "", label: "Add an override for a Tower, Sub-Tower or LOB…" }, ...[...groups].map(([label, items]) => ({ label, items }))];
  const byKey = new Map(free.map(p => [placeKey(p), p]));
  return (
    <tr className="border-b border-row">
      <td colSpan={7} className="px-5 py-2 pl-9">
        <Select
          value="" aria-label={`Add an override of ${r.name}`} options={options} className="field h-[34px] px-2.5 text-[13px] text-muted"
          // It starts as the rule applies there, with the threshold set, ready to change.
          onChange={k => { const p = byKey.get(k); if (p) onPatch(r, p, { thr: ruleFor(r, p).thr }); }}
        />
      </td>
    </tr>
  );
}
