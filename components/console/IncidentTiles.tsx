import { teamOf } from "@/lib/engine/scope";
import type { Agent, Incident, Team } from "@/lib/types";

/** Agents with incident reports: one tile per agent, with why each incident was opened. */
export function IncidentTiles({ incidents, agents, org }: { incidents: Incident[]; agents: Agent[]; org: Team[] }) {
  const byAgent = new Map<string, Incident[]>();
  for (const i of incidents) byAgent.set(i.agent, [...(byAgent.get(i.agent) ?? []), i]);
  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Agents with incident reports</h2>
        <span className="panel-sub">Your span · why each incident was opened</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 px-5 pb-5 pt-4">
        {[...byAgent].map(([name, list]) => {
          const t = teamOf(org, agents.find(a => a.name === name)?.team ?? list[0].team);
          const open = list.some(i => i.status !== "Closed");
          return (
            <div
              key={name}
              className={`flex flex-col gap-1.5 rounded-15 px-4 py-3.5 ${open ? "bg-error-fill shadow-[inset_0_0_0_1px_var(--error)]" : "bg-page opacity-75 shadow-[inset_0_0_0_1px_var(--neutral-300)]"}`}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[15px] font-semibold">{name}</span>
                <span className="font-ui text-xs font-semibold text-error-text">{list.length} IR{list.length > 1 ? "s" : ""}{open ? "" : " · all closed"}</span>
              </div>
              <span className="text-xs text-muted">{t.team} · TL {t.tl}</span>
              <span className="text-pretty text-[13px] leading-normal">Cause: {list.map(i => `${i.rule} ×${i.instances}${i.status === "Closed" ? " (closed)" : ""}`).join(" · ")}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
