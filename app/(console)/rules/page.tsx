"use client";

import { useCallback } from "react";
import { ROUTES } from "@/lib/engine/rules";
import { api, attempt } from "@/lib/client/api";
import { usePerms } from "@/lib/client/hooks";
import { useConsole } from "@/lib/client/store";
import type { Rule } from "@/lib/types";
import { PageTitle } from "@/components/ui/primitives";
import { RuleRow } from "@/components/rules/RuleRow";

const HEADERS = ["Rule", "Type", "Condition", "Threshold", "Severity", "Escalation route", "Enabled"];

export default function RulesPage() {
  const rules = useConsole(s => s.rules);
  const toast = useConsole(s => s.toast);
  const canEdit = !!usePerms()?.rulesEdit;

  const onPatch = useCallback(async (r: Rule, patch: Partial<Pick<Rule, "thr" | "sev" | "route" | "on">>) => {
    if (!(await attempt(api.patchRule(r.id, patch)))) return;
    if (patch.sev) toast("info", `${r.name} severity set`, `${patch.sev === "crit" ? "Critical" : "Warning"}. Applies to the next trigger.`);
    if (patch.route) toast("info", `${r.name} route updated`, ROUTES.find(x => x[0] === patch.route)![1]);
  }, [toast]);

  return (
    <section className="flex flex-col gap-5">
      <PageTitle eyebrow="Detect" title="Rules engine" />
      <p className="m-0 max-w-[880px] text-pretty text-base leading-[1.6] text-strong">
        This table is the standard monitoring approach. Duration rules watch live states (ACW, aux, break, offline, long calls); event rules fire per occurrence (short calls). <b className="text-ink">Severity</b> sets how a call-out is styled and treated. <b className="text-ink">Escalation route</b> sets who is called out and how far it can climb: full ladders escalate on repeats (2nd to TL, 3rd to Ops with an incident number); capped routes stop at their rung and never open incidents. <b className="text-ink">System rules</b> watch the platform itself, so a silent Gencloud feed becomes a call-out, not a mystery.
      </p>
      <div className={`box-border flex max-w-[880px] items-center gap-3 rounded-15 px-4 py-3 ${canEdit ? "bg-tint text-purple-900" : "bg-page text-muted"}`}>
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
              <tr className="bg-page">
                {HEADERS.map((h, i) => (
                  <th key={h} scope="col" className={`py-3 text-left font-ui text-xs font-semibold text-muted ${i === 0 || i === HEADERS.length - 1 ? "px-5" : "px-3.5"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.map(r => <RuleRow key={r.id} rule={r} canEdit={canEdit} onPatch={onPatch} />)}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
