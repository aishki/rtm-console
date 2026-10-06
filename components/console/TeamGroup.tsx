import { isBreach } from "@/lib/engine/rules";
import type { Agent, AgentState, Rule, Team } from "@/lib/types";
import { AgentCard } from "./AgentCard";

const MIX: { label: string; states: AgentState[]; color: string }[] = [
  { label: "On call", states: ["oncall", "outb"], color: "#00BBBA" },
  { label: "avail", states: ["avail"], color: "#449E3C" },
  { label: "ACW", states: ["acw"], color: "#F2BC35" },
  { label: "aux", states: ["auxb", "auxp"], color: "#794CFF" },
  { label: "off", states: ["off"], color: "#929299" },
];

interface Props {
  team: Team;
  /** Every agent on the team in span (drives the mix and breach count). */
  all: Agent[];
  /** The agents to show after filtering and sorting. */
  shown: Agent[];
  rules: Rule[];
  open: boolean;
  filtering: boolean;
  query: string;
  showMetrics: boolean;
  onToggle: () => void;
}

/** Collapsible team on the agent grid, with its state mix in the header. */
export function TeamGroup({ team, all, shown, rules, open, filtering, query, showMetrics, onToggle }: Props) {
  const breach = all.filter(a => isBreach(a, rules)).length;
  const mix = MIX.map(m => ({ ...m, n: all.filter(a => m.states.includes(a.state)).length }));
  // The live feed has no leader names yet, so those parts are left out rather than shown blank.
  const sub = [team.tl && `TL ${team.tl}`, team.mgr && `Mgr ${team.mgr}`, `${filtering ? `${shown.length} of ${all.length}` : all.length} agents`].filter(Boolean).join(" · ");
  return (
    <div className="@container rounded-15 bg-white ring-card">
      {/* One line at every width: the name trims first, then the sub-line; narrow panels drop the counts and keep the bar. */}
      <button type="button" onClick={onToggle} aria-expanded={open} className={`flex w-full items-center gap-x-3.5 rounded-15 border-0 px-4 py-3 text-left text-inherit ${open ? "bg-tint" : "bg-white"}`}>
        <svg width="16" height="8" viewBox="0 0 16 8" fill="none" aria-hidden="true" className="shrink-0 transition-transform duration-200 ease-standard" style={{ transform: `rotate(${open ? 0 : -90}deg)` }}>
          <path d="M1 1l7 6 7-6" stroke="#303044" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span title={team.team} className="min-w-16 truncate text-base font-semibold text-purple">{team.team}</span>
        <span className="hidden min-w-[68px] shrink-[100] truncate text-xs text-muted @[420px]:inline">{sub}</span>
        <div className="flex-1" />
        {breach > 0 && <span className="pill shrink-0 whitespace-nowrap bg-error-tint text-error-text">{breach} breaching</span>}
        <span className="num hidden shrink-0 whitespace-nowrap text-xs text-muted @[640px]:inline">{mix.map(m => `${m.n} ${m.label}`).join(" · ")}</span>
        <span aria-hidden="true" className="flex h-2 w-[120px] shrink-0 overflow-hidden rounded-4 bg-row">
          {mix.map(m => <span key={m.label} className="h-full" style={{ width: `${all.length ? (m.n / all.length) * 100 : 0}%`, background: m.color }} />)}
        </span>
      </button>
      {open && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5 px-4 pb-4 pt-1">
          {shown.map(a => <AgentCard key={a.id} agent={a} rules={rules} query={query} showMetrics={showMetrics} />)}
        </div>
      )}
    </div>
  );
}
