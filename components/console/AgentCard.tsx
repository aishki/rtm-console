import { memo } from "react";
import { fmt, splitAgent } from "@/lib/engine/format";
import { STATES, isBreach, isCrit, strikesOf } from "@/lib/engine/rules";
import type { Agent, Rule } from "@/lib/types";

function Name({ name, query }: { name: string; query: string }) {
  const i = query ? name.toLowerCase().indexOf(query) : -1;
  if (i < 0) return <>{name}</>;
  return <>{name.slice(0, i)}<mark>{name.slice(i, i + query.length)}</mark>{name.slice(i + query.length)}</>;
}

interface Props { agent: Agent; rules: Rule[]; /** Lower-cased search text to highlight in the name. */ query: string; showMetrics: boolean }

/** One agent on the grid: state, time in state, strikes, and a breach glow. */
export const AgentCard = memo(function AgentCard({ agent: a, rules, query, showMetrics }: Props) {
  const s = STATES[a.state] ?? STATES.avail;
  const breach = isBreach(a, rules), crit = breach && isCrit(a, rules);
  const strikes = strikesOf(a);
  const { who, id } = splitAgent(a.name);
  const skin = crit ? "bg-error-fill shadow-[inset_0_0_0_2px_var(--error)]" : breach ? "bg-warning-fill shadow-[inset_0_0_0_2px_var(--warning)]" : "bg-white ring-card";
  const metric = (label: string, value: string | number) => <span className="whitespace-nowrap">{label} <b className="text-ink">{value}</b></span>;
  return (
    <div className={`relative flex min-w-0 flex-col gap-2 rounded-15 px-3.5 py-3 ${skin}`}>
      {strikes > 0 && (
        <span title="Triggers this shift" className="absolute right-3 top-2.5 rounded-pill bg-pale-purple px-2 py-px font-ui text-xs font-semibold text-purple">×{strikes}</span>
      )}
      {/* No team line: the card always sits under its team's header. The ID gets its own line so a long name never hides it. */}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span title={a.name} className="truncate pr-9 text-sm font-semibold"><Name name={who} query={query} /></span>
        {id && <span className="num truncate text-[11px] text-muted"><Name name={id} query={query} /></span>}
      </div>
      <div className="flex items-center gap-2">
        <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: s.color }} />
        <span className="truncate text-[13px] font-medium">{s.label}</span>
        {a.onHold && <span className="rounded-pill bg-warning-tint px-[7px] py-px font-ui text-[11px] font-semibold text-warning-text">Hold {fmt(a.holdTime)}</span>}
        <span className={`num ml-auto text-[13px] font-semibold ${crit ? "text-error-text" : breach ? "text-warning-text" : "text-ink"}`}>{fmt(a.stTime)}</span>
      </div>
      {showMetrics && (
        // Two tidy rows in three columns that line up from card to card: handling on the first row, call quality on the second.
        <div className="num grid grid-cols-[1fr_1fr_52px] gap-x-1.5 gap-y-1 border-t border-row pt-2 text-[11px] text-muted">
          {metric("AHT", a.aht + "s")}{metric("Calls", a.calls)}{metric("Adh", a.adh.toFixed(0) + "%")}
          {metric("Short", a.shortCalls)}{metric("Xfr", a.transfers)}
        </div>
      )}
    </div>
  );
});
