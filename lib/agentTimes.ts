import type { Agent, AgentView } from "@/lib/types";

/** The agent as the stream sends it: when its state and hold began, instead of counters that change every second. */
export function toView(a: Agent, t: number): AgentView {
  const { stTime, holdTime, ...rest } = a;
  // Off hold the engine leaves the last hold's counter as it was; 0 keeps the agent unchanged from tick to tick.
  return { ...rest, stAt: t - stTime, holdAt: a.onHold ? t - holdTime : 0 };
}

/** The agent with its time in state and on hold as of engine second `t`, for the rule tests. */
export function withTimes(a: AgentView, t: number): Agent {
  const { stAt, holdAt, ...rest } = a;
  return { ...rest, stTime: Math.max(0, t - stAt), holdTime: a.onHold ? Math.max(0, t - holdAt) : 0 };
}

/** Swap in the agents that changed, keeping the rest (and the array, when nothing changed) as they were. */
export function mergeAgents(old: AgentView[], changed: AgentView[] | undefined): AgentView[] {
  if (!changed?.length) return old;
  const byId = new Map(changed.map(a => [a.id, a]));
  return old.map(a => byId.get(a.id) ?? a);
}
