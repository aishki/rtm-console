import type { Agent, AgentState, Role, Route, Rule, RuleId } from "@/lib/types";
import { fmt } from "./format";

export const STATES: Record<AgentState, { label: string; color: string }> = {
  oncall: { label: "On Call", color: "#00BBBA" },
  avail: { label: "Available", color: "#449E3C" },
  acw: { label: "ACW", color: "#F2BC35" },
  auxb: { label: "Aux Break", color: "#794CFF" },
  auxp: { label: "Aux Personal", color: "#5009B5" },
  outb: { label: "Outbound", color: "#44B8F3" },
  off: { label: "Offline", color: "#929299" },
};
export const STATE_IDS = Object.keys(STATES) as AgentState[];
export const STATE_OPTIONS: [AgentState | "ignore", string][] = [
  ["oncall", "On Call"], ["avail", "Available"], ["acw", "ACW"], ["auxb", "Aux Break"],
  ["auxp", "Aux Personal"], ["outb", "Outbound"], ["off", "Offline"], ["ignore", "Ignore these rows"],
];
export const ROUTES: [Route, string][] = [
  ["nudge", "Agent nudge → TL → Ops"],
  ["lead", "TL first → Ops"],
  ["nudgeonly", "Agent nudge only (no escalation)"],
  ["leadonly", "TL only (no auto-Ops)"],
];
export const ROUTE_IDS = ROUTES.map(r => r[0]);
export const DISPOSITIONS = ["Coached & documented", "Validated / excused", "Referred to HR / PIP", "System issue / no fault"];
export const ROLES: [Role, string][] = [
  ["admin", "Admin (WFM)"], ["senior", "Senior Leader"], ["mgr", "Manager"], ["tl", "Team Lead / AM"], ["agent", "Agent"],
];
export const ROLE_LABEL = Object.fromEntries(ROLES) as Record<Role, string>;

export function defaultRules(): Rule[] {
  return [
    { id: "acw", name: "Extended ACW", type: "duration", cond: "State ACW longer than", thr: 120, unit: "s", sev: "warn", route: "nudge", on: true },
    { id: "auxp", name: "Unscheduled Aux", type: "duration", cond: "Aux Personal longer than", thr: 300, unit: "s", sev: "warn", route: "nudge", on: true },
    { id: "ovbrk", name: "Overbreak", type: "duration", cond: "Aux Break longer than", thr: 900, unit: "s", sev: "warn", route: "nudge", on: true },
    { id: "offl", name: "Prolonged offline", type: "duration", cond: "Offline mid-shift longer than", thr: 600, unit: "s", sev: "crit", route: "lead", on: true },
    { id: "long", name: "Long call", type: "duration", cond: "On Call longer than", thr: 900, unit: "s", sev: "crit", route: "lead", on: true },
    { id: "hold", name: "Long hold", type: "duration", cond: "Member on hold longer than", thr: 120, unit: "s", sev: "warn", route: "nudge", on: true },
    { id: "outb", name: "Outbound call", type: "duration", cond: "Outbound call longer than", thr: 600, unit: "s", sev: "warn", route: "lead", on: true },
    { id: "short", name: "Short call", type: "event", cond: "Call released under", thr: 30, unit: "s", sev: "warn", route: "nudge", on: true },
    { id: "adh", name: "Adherence breach", type: "duration", cond: "Shift adherence below", thr: 90, unit: "%", sev: "warn", route: "nudge", on: true },
    { id: "xfer", name: "Transfer rate", type: "ratio", cond: "Transfer rate above (min 5 calls)", thr: 25, unit: "%", sev: "warn", route: "nudge", on: true },
    { id: "cq", name: "Queue backlog", type: "queue", cond: "Calls in queue above", thr: 8, unit: "calls", sev: "crit", route: "lead", on: true },
    { id: "sl", name: "Service level", type: "queue", cond: "Interval SL below", thr: 80, unit: "%", sev: "crit", route: "lead", on: true },
    { id: "aband", name: "Abandon rate", type: "queue", cond: "Interval abandon above", thr: 5, unit: "%", sev: "crit", route: "lead", on: true },
    { id: "gnr", name: "Gencloud not responding", type: "system", cond: "Feed stale longer than", thr: 30, unit: "s", sev: "crit", route: "lead", on: true },
  ];
}

export const ruleOf = (rules: Rule[], id: RuleId): Rule => rules.find(r => r.id === id)!;
export const thrOf = (rules: Rule[], id: RuleId): number => ruleOf(rules, id).thr;

type Test = (a: Agent, thr: number) => boolean;
/** Agent-level predicates. Event, queue and system rules have no per-agent test. */
export const AGENT_TESTS: Partial<Record<RuleId, Test>> = {
  acw: (a, thr) => a.state === "acw" && a.stTime >= thr,
  auxp: (a, thr) => a.state === "auxp" && a.stTime >= thr,
  ovbrk: (a, thr) => a.state === "auxb" && a.stTime >= thr,
  offl: (a, thr) => a.state === "off" && a.stTime >= thr,
  long: (a, thr) => a.state === "oncall" && a.stTime >= thr,
  hold: (a, thr) => a.state === "oncall" && a.onHold && a.holdTime >= thr,
  outb: (a, thr) => a.state === "outb" && a.stTime >= thr,
  adh: (a, thr) => a.adh < thr,
  xfer: (a, thr) => a.calls >= 5 && (a.transfers / a.calls) * 100 >= thr,
};
/** Adherence and Transfer rate fire once per shift and never re-arm. */
export const ONCE_PER_SHIFT: RuleId[] = ["adh", "xfer"];

const VALUE_OF: Partial<Record<RuleId, (a: Agent) => string>> = {
  hold: a => fmt(a.holdTime),
  adh: a => a.adh.toFixed(0) + "%",
  xfer: a => `${((a.transfers / a.calls) * 100).toFixed(0)}% (${a.transfers}/${a.calls})`,
};
export const valueOf = (id: RuleId, a: Agent): string => (VALUE_OF[id] ?? (x => fmt(x.stTime)))(a);

const NUDGE_COPY: Partial<Record<RuleId, (a: Agent, rules: Rule[]) => string>> = {
  acw: a => `You've been in after-call work for ${fmt(a.stTime)}. If the case is closed, set yourself back to Available.`,
  auxp: a => `You've been in Aux Personal for ${fmt(a.stTime)}. Your team needs you on the queue, so head back when you can.`,
  ovbrk: a => `Your break has run ${fmt(a.stTime)}, past the scheduled window. Please head back to Available.`,
  short: (_a, rules) => `That last call released in under ${thrOf(rules, "short")}s. If it dropped, log it; if the member hung up, no action needed. This is tracked for patterns.`,
  adh: a => `Your adherence has dipped to ${a.adh.toFixed(0)}%. Sticking close to your schedule for the rest of the shift will bring it back.`,
  hold: a => `The member has been on hold for ${fmt(a.holdTime)}. Check back in, or take them off hold if you're ready.`,
  outb: a => `This outbound call has been running ${fmt(a.stTime)}. If the callback is complete, wrap up and return to the queue.`,
  xfer: a => `Your transfer rate is at ${((a.transfers / Math.max(1, a.calls)) * 100).toFixed(0)}% today. If the transfers feel unavoidable, tell your TL what's driving them.`,
};
export const nudgeCopy = (r: Rule, a: Agent, rules: Rule[]): string => (NUDGE_COPY[r.id] ?? (() => r.name))(a, rules);

/** True when an enabled rule's test passes for the agent. Offline agents only count for Prolonged offline. */
export function ruleApplies(r: Rule, a: Agent): boolean {
  const test = AGENT_TESTS[r.id];
  if (!r.on || !test) return false;
  if (r.id !== "offl" && a.state === "off") return false;
  return test(a, r.thr);
}
export const isBreach = (a: Agent, rules: Rule[]): boolean => rules.some(r => ruleApplies(r, a));
export const isCrit = (a: Agent, rules: Rule[]): boolean =>
  (a.state === "oncall" && a.stTime >= thrOf(rules, "long")) || (a.state === "off" && a.stTime >= thrOf(rules, "offl"));

export const strikesOf = (a: Agent): number => Object.values(a.strikes).reduce((x, y) => x + (y ?? 0), 0);

/**
 * One pass of the agent-level rules. A rule fires once per state episode: `fired` is set on
 * the first passing test and cleared when the test stops passing (or the state changes,
 * which resets `fired` altogether), except for the once-per-shift rules.
 */
export function evaluateAgents(agents: Agent[], rules: Rule[], fire: (r: Rule, a: Agent) => void): void {
  for (const a of agents) for (const r of rules) {
    const test = AGENT_TESTS[r.id];
    if (!r.on || !test) continue;
    if (r.id !== "offl" && a.state === "off") continue;
    if (test(a, r.thr)) { if (!a.fired[r.id]) { a.fired[r.id] = true; fire(r, a); } }
    else if (a.fired[r.id] && !ONCE_PER_SHIFT.includes(r.id)) a.fired[r.id] = false;
  }
}

export type TargetLevel = "ok" | "watch" | "breach" | "off";
export interface Target { id: RuleId; name: string; cond: string; now: string; lvl: TargetLevel; stat: string }

/** The agent's own view of every agent-level rule (My targets & timers). */
export function myTargets(a: Agent, rules: Rule[]): Target[] {
  const MAP: Partial<Record<RuleId, AgentState>> = { acw: "acw", auxp: "auxp", ovbrk: "auxb", offl: "off", long: "oncall", outb: "outb" };
  return rules.filter(r => r.type !== "queue" && r.type !== "system").map(r => {
    let now = "—", lvl: TargetLevel = "ok", stat = "OK";
    const timer = (v: number) => {
      now = fmt(v);
      const p = v / r.thr;
      if (p >= 1) { lvl = "breach"; stat = "Breached"; } else if (p >= 0.7) { lvl = "watch"; stat = "Approaching"; }
    };
    if (!r.on) { stat = "Rule off"; lvl = "off"; }
    else if (r.id === "adh") {
      now = a.adh.toFixed(0) + "%";
      if (a.adh < r.thr) { lvl = "breach"; stat = "Breached"; } else if (a.adh < r.thr + 2) { lvl = "watch"; stat = "Watch"; }
    } else if (r.id === "xfer") {
      const p = a.calls ? (a.transfers / a.calls) * 100 : 0;
      now = `${p.toFixed(0)}% (${a.transfers}/${a.calls})`;
      if (a.calls >= 5 && p >= r.thr) { lvl = "breach"; stat = "Breached"; } else if (a.calls >= 5 && p >= r.thr * 0.8) { lvl = "watch"; stat = "Watch"; }
    } else if (r.id === "short") {
      now = a.shortCalls + " today";
      if (a.shortCalls > 0) { lvl = "watch"; stat = "Tracked"; }
    } else if (r.id === "hold") {
      if (a.state === "oncall" && a.onHold) timer(a.holdTime);
    } else if (a.state === MAP[r.id]) timer(a.stTime);
    return { id: r.id, name: r.name, cond: `${r.cond} ${r.thr}${r.unit}`, now, lvl, stat };
  });
}
