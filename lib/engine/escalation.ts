import type { Agent, Incident, Instance, NudgeEvent, Queue, QueueCounts, ReplayMeta, Route, Rule, RuleId, Stage, Team, ToastEvent } from "@/lib/types";
import { nudgeCopy, valueOf } from "./rules";
import { teamOf } from "./scope";
import { wallClock } from "@/lib/floorTime";

export interface EngineHooks {
  toast?: (e: ToastEvent) => void;
  nudge?: (e: NudgeEvent) => void;
}

/** Hands out incident numbers, INC-<year>-0001 on. The Genesys orgs' floors share one, so numbers never repeat across orgs. */
export interface IncidentCounter { next(): string }

/** Where a counter is: the year it numbers in and the last number it gave. */
export interface IncidentSeq { year: number; n: number }

/** The floor's year (US Eastern): numbering starts again at 0001 when it changes. */
const floorYear = () => wallClock(new Date()).year;

/** A counter over `seq` (kept by the caller when it is shared). `year` is the floor's year unless a test fixes it. */
export function incidentCounter(seq: IncidentSeq = { year: 0, n: 0 }, year: () => number = floorYear): IncidentCounter {
  return {
    next() {
      const y = year();
      if (y !== seq.year) { seq.year = y; seq.n = 0; }
      return `INC-${y}-${String(++seq.n).padStart(4, "0")}`;
    },
  };
}

export interface EngineState {
  /** Shift clock, seconds since midnight. */
  t: number;
  mode: "live" | "replay";
  replay: ReplayMeta | null;
  org: Team[];
  agents: Agent[];
  rules: Rule[];
  /** Newest first. */
  ledger: Instance[];
  /** Newest first. */
  incidents: Incident[];
  seq: number;
  /** Seconds since the feed last spoke. 0 while healthy. */
  staleFor: number;
  /** The feed's roster and first states are still loading: agents may be from the saved roster, Offline until heard from. */
  agentsLoading: boolean;
  /** Suppresses toasts and nudges (history warm-up). */
  quiet: boolean;
  queue: Queue | null;
  /** Each queue's latest counts, by queue name. Empty until a feed sends them. */
  queues: Record<string, QueueCounts>;
  /** Queue name to the ids of its agents. An agent in several queues is in each. */
  members: Record<string, number[]>;
  /** Bumped on every roster, so a reader can tell the membership changed. Never reset. */
  rosterRev: number;
  /** Floor-level rules currently in breach; they re-arm on recovery. */
  floorFired: Partial<Record<RuleId, boolean>>;
  /** Bumped on every ledger change. */
  rev: number;
}

/** The name a nudge greets with. Gencloud names read "Last, First Middle - ID". */
export const firstName = (name: string): string => (name.includes(",") ? name.slice(name.indexOf(",") + 1) : name).trim().split(" ")[0];

/** A capped route stops at its rung; a full ladder climbs with the strike count. */
export const isFullLadder = (route: Route): boolean => route === "nudge" || route === "lead";

/**
 * Stage for a call-out. Floor call-outs (strikes = 0) stay on the route's first rung.
 * Full ladders: strike 2 reaches the TL, strike 3 and later reach Ops.
 */
export function stageFor(route: Route, strikes: number): Stage {
  const first: Stage = route === "lead" || route === "leadonly" ? "lead" : "nudge";
  if (!isFullLadder(route)) return first;
  if (strikes >= 3) return "ops";
  if (strikes === 2) return "lead";
  return first;
}

/** Every strike from 3 on opens its own incident: strike 5 on one rule means 3 incidents to investigate. `instances` is the strike that opened it. */
export function openIncident(S: EngineState, counter: IncidentCounter, agent: Agent, r: Rule, strikes: number): string {
  const inc = counter.next();
  S.incidents.unshift({ inc, t: S.t, agent: agent.name, team: agent.team, rule: r.name, ruleId: r.id, instances: strikes, status: "Open", disposition: "", closedT: null });
  return inc;
}

/** Log a call-out, count the strike, climb the ladder and notify. `agent` is null for queue and system rules. */
export function fire(S: EngineState, hooks: EngineHooks, counter: IncidentCounter, r: Rule, agent: Agent | null, detail?: string): Instance {
  let strikes = 0, inc = "";
  if (agent) { agent.strikes[r.id] = (agent.strikes[r.id] ?? 0) + 1; strikes = agent.strikes[r.id]!; }
  const stage = stageFor(r.route, strikes);
  if (agent && stage === "ops") inc = openIncident(S, counter, agent, r, strikes);
  const val = detail ?? (agent ? valueOf(r.id, agent) : "");
  const rec: Instance = {
    n: ++S.seq, t: S.t, agent: agent ? agent.name : "Queue", isFloor: !agent, team: agent ? agent.team : "Floor",
    rule: r.name, ruleId: r.id, val, stage, sev: stage === "ops" ? "esc" : r.sev, status: "open", ackT: null,
    strikes, inc, cmt: null, cond: `${r.cond} ${r.thr}${r.unit}`, rev: ++S.rev,
  };
  S.ledger.unshift(rec);
  if (S.quiet) return rec;
  if (stage === "nudge" && agent) {
    hooks.nudge?.({ n: rec.n, agent: agent.name, team: agent.team, first: firstName(agent.name), body: nudgeCopy(r, agent, S.rules) });
  } else if (stage === "lead") {
    const crit = r.sev === "crit";
    hooks.toast?.({
      kind: crit ? "crit" : "warn", instance: rec,
      title: `${rec.agent} · ${r.name}${crit ? " · Critical" : ""}`,
      body: `${rec.cond} · now ${val}${strikes > 1 ? ` · strike ${strikes}` : ""} · to TL ${agent ? teamOf(S.org, agent.team).tl : "(floor)"}`,
    });
  } else if (stage === "ops" && agent) {
    hooks.toast?.({
      kind: "esc", instance: rec,
      title: `Ops escalation · ${rec.agent}`,
      body: `${r.name}: strike ${strikes}. ${inc} opened · Mgr ${teamOf(S.org, agent.team).mgr} notified.`,
    });
  }
  return rec;
}
