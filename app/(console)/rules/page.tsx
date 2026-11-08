"use client";

import { Fragment, useCallback, useMemo } from "react";
import { ROUTES } from "@/lib/engine/rules";
import { type OverridePatch, placeLabel, placesIn } from "@/lib/engine/overrides";
import { api, attempt } from "@/lib/client/api";
import { usePerms } from "@/lib/client/hooks";
import { useConsole } from "@/lib/client/store";
import type { Place, Rule } from "@/lib/types";
import { PageTitle } from "@/components/ui/primitives";
import { RuleRow } from "@/components/rules/RuleRow";
import { OverrideRows } from "@/components/rules/OverrideRows";

const HEADERS = ["Rule", "Type", "Condition", "Threshold", "Severity", "Escalation route", "Enabled"];

export default function RulesPage() {
  const rules = useConsole(s => s.rules);
  const toast = useConsole(s => s.toast);
  const canEdit = !!usePerms()?.rulesEdit;
  const queueMap = useConsole(s => s.queueMap);
  const places = useMemo(() => placesIn(queueMap), [queueMap]);

  const onPatch = useCallback(async (r: Rule, patch: Partial<Pick<Rule, "thr" | "sev" | "route" | "on">>) => {
    if (!(await attempt(api.patchRule(r.id, patch)))) return;
    if (patch.sev) toast("info", `${r.name} severity set`, `${patch.sev === "crit" ? "Critical" : "Warning"}. Applies to the next trigger.`);
    if (patch.route) toast("info", `${r.name} route updated`, ROUTES.find(x => x[0] === patch.route)![1]);
  }, [toast]);

  const onOverride = useCallback(async (r: Rule, place: Place, patch: OverridePatch) => {
    const res = await attempt(api.patchOverride(r.id, place, patch));
    if (res && !res.override) toast("info", `${r.name} override removed`, `${placeLabel(place)} follows the level above again.`);
  }, [toast]);

  return (
    <section className="flex flex-col gap-5">
      <PageTitle eyebrow="Detect" title="Rules engine" />
      <p className="m-0 text-pretty text-base leading-[1.6] text-strong">
        This table is the standard monitoring approach. Duration rules watch live states (ACW, aux, break, offline, long calls); event rules fire per occurrence (short calls). <b className="text-ink">Severity</b> sets how a call-out is styled and treated. <b className="text-ink">Escalation route</b> sets who is called out and how far it can climb: full ladders escalate on repeats (2nd to TL, 3rd to Ops with an incident number); capped routes stop at their rung and never open incidents. <b className="text-ink">System rules</b> watch the platform itself, so a silent Gencloud feed becomes a call-out, not a mystery. <b className="text-ink">Overrides</b> change a rule for one Tower, Sub-Tower or LOB from the queue mapping: an agent gets the settings of the LOB their queues are in, and the most specific one wins for each setting, with an empty one taken from the level above. A queue rule with an override is also checked against that group&apos;s own numbers.
      </p>
      <div className={`box-border flex items-center gap-3 rounded-15 px-4 py-3 ${canEdit ? "bg-tint text-purple-900" : "bg-page text-muted"}`}>
        <span className="text-sm font-medium leading-normal">
          {canEdit
            ? "You have rules-admin access in this view. Thresholds, severity, routes and toggles are live and apply to the next trigger."
            : "Read-only in this view. Managers and Admin (WFM) hold rules-admin access."}
        </span>
      </div>
      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {HEADERS.map((h, i) => (
                  <th key={h} scope="col" className={`th py-3 text-left ${i === 0 || i === HEADERS.length - 1 ? "px-5" : "px-3.5"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.map(r => (
                <Fragment key={r.id}>
                  <RuleRow rule={r} canEdit={canEdit} onPatch={onPatch} />
                  <OverrideRows rule={r} canEdit={canEdit} places={places} onPatch={onOverride} />
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
