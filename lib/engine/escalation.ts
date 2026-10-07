import type { Agent, Incident, Instance, NudgeEvent, Queue, ReplayMeta, Route, Rule, RuleId, Stage, Team, ToastEvent } from "@/lib/types";
import { nudgeCopy, valueOf } from "./rules";
import { teamOf } from "./scope";

export interface EngineHooks {
  toast?: (e: ToastEvent) => void;
  nudge?: (e: NudgeEvent) => void;
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
  incSeq: number;
  /** Seconds since the feed last spoke. 0 while healthy. */
  staleFor: number;
  /** Suppresses toasts and nudges (history warm-up). */
  quiet: boolean;
  queue: Queue | null;
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

/** At most one open incident per agent per rule; later strikes raise its instance count. */
export function openIncident(S: EngineState, agent: Agent, r: Rule, strikes: number): string {
  const ex = S.incidents.find(i => i.agent === agent.name && i.ruleId === r.id && i.status !== "Closed");
  if (ex) { ex.instances = strikes; return ex.inc; }
  const inc = "INC-2026-" + String(++S.incSeq).padStart(4, "0");
  S.incidents.unshift({ inc, t: S.t, agent: agent.name, team: agent.team, rule: r.name, ruleId: r.id, instances: strikes, status: "Open", disposition: "", closedT: null });
  return inc;
}

/** Log a call-out, count the strike, climb the ladder and notify. `agent` is null for queue and system rules. */
export function fire(S: EngineState, hooks: EngineHooks, r: Rule, agent: Agent | null, detail?: string): Instance {
  let strikes = 0, inc = "";
  if (agent) { agent.strikes[r.id] = (agent.strikes[r.id] ?? 0) + 1; strikes = agent.strikes[r.id]!; }
  const stage = stageFor(r.route, strikes);
  if (agent && stage === "ops") inc = openIncident(S, agent, r, strikes);
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
