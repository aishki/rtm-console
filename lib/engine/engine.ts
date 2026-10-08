import type { Agent, AgentStateEvent, Incident, Instance, Queue, ReplayMeta, Roster, Route, Rule, RuleId, Severity, View } from "@/lib/types";
import type { FeedHandlers } from "@/lib/feed/FeedSource";
import { DISPOSITIONS, ONCE_PER_SHIFT, ROUTE_IDS, defaultRules, evaluateAgents, ruleApplies, ruleOf, thrOf } from "./rules";
import { type EngineHooks, type EngineState, fire as fireRule } from "./escalation";
import { scopeLedger } from "./scope";

export interface EngineOptions {
  /** Share a rule set between engines (live and replay read the same configuration). */
  rules?: Rule[];
  /** Model adherence drift from state time when the feed does not supply adherence. */
  deriveAdh?: boolean;
}

/** A new state episode re-arms every rule except the once-per-shift ones. */
function oncePerShift(fired: Agent["fired"]): Agent["fired"] {
  const keep: Agent["fired"] = {};
  for (const id of ONCE_PER_SHIFT) if (fired[id]) keep[id] = true;
  return keep;
}

export type Engine = ReturnType<typeof createEngine>;

/**
 * The rules engine. It owns the shift clock, state timers, strikes, the ledger and incidents.
 * Agent states, queue metrics and heartbeats arrive through `ingest` (a FeedSource pushes
 * them); `tick()` advances one second and evaluates every rule.
 */
export function createEngine(hooks: EngineHooks = {}, opts: EngineOptions = {}) {
  const S: EngineState = {
    t: 0, mode: "live", replay: null, org: [], agents: [], rules: opts.rules ?? defaultRules(),
    ledger: [], incidents: [], seq: 0, incSeq: 0, staleFor: 0, quiet: false, queue: null, floorFired: {}, rev: 0,
  };
  let beat = false;
  let pending: AgentStateEvent[] = [];
  let pendingQueue: Queue | null = null;

  const thr = (id: RuleId) => thrOf(S.rules, id);
  const rule = (id: RuleId) => ruleOf(S.rules, id);
  const toast: NonNullable<EngineHooks["toast"]> = e => { if (!S.quiet) hooks.toast?.(e); };
  const fire = (r: Rule, a: Agent | null, detail?: string) => fireRule(S, { toast, nudge: hooks.nudge }, r, a, detail);

  const ingest: FeedHandlers = {
    /** A roster resent mid-shift (the feed reconnected) keeps each known agent's shift counters and strikes. */
    onRoster(r: Roster) {
      const prev = new Map(S.agents.map(a => [a.name, a]));
      S.org = r.org.map(t => ({ ...t }));
      S.agents = r.agents.map((a, i) => {
        const p = prev.get(a.name);
        return {
          id: i, name: a.name, team: a.team, state: a.state, stTime: a.stTime ?? 0, onHold: false, holdTime: 0,
          aht: p?.aht ?? a.aht ?? 420, calls: p?.calls ?? a.calls ?? 0, shortCalls: p?.shortCalls ?? 0, transfers: p?.transfers ?? 0,
          adh: p?.adh ?? a.adh ?? 96, strikes: p?.strikes ?? {}, fired: p?.fired ?? {},
        };
      });
      beat = true;
    },
    onAgentState(e) { pending.push(e); beat = true; },
    onQueue(q) { pendingQueue = q; beat = true; },
    onHeartbeat() { beat = true; },
  };

  function applyAgentState(e: AgentStateEvent) {
    const a = S.agents.find(x => x.name === e.agent);
    if (!a) return;
    if (e.callEnded) {
      const dur = a.stTime;
      a.calls++;
      // A replay has no AHT baseline, so the first call seeds it.
      a.aht = S.mode === "replay" && a.calls === 1 ? dur : Math.round(a.aht * 0.85 + dur * 0.15);
      if (e.callEnded.transferred) a.transfers++;
      if (rule("short").on && dur < thr("short")) { a.shortCalls++; fire(rule("short"), a, `${dur}s call`); }
    }
    if (e.state !== a.state) {
      if (a.state === "oncall") { a.onHold = false; a.holdTime = 0; }
      a.state = e.state; a.stTime = 0; a.fired = oncePerShift(a.fired);
    }
    if (e.onHold !== undefined && e.onHold !== a.onHold) { a.onHold = e.onHold; a.holdTime = 0; }
    if (e.adh !== undefined) a.adh = e.adh;
  }

  function advance() {
    for (const a of S.agents) {
      a.stTime++;
      if (a.onHold) a.holdTime++;
    }
    for (const e of pending) applyAgentState(e);
    pending = [];
    if (pendingQueue) { S.queue = pendingQueue; pendingQueue = null; }
    if (opts.deriveAdh) for (const a of S.agents) {
      a.adh = Math.max(70, Math.min(100, a.adh + (a.state === "auxp" || a.state === "off" ? -0.03 : a.state === "oncall" ? 0.008 : 0)));
    }
  }

  /** Queue and system rules fire once per breach and re-arm on recovery. */
  function floorRule(id: RuleId, breached: boolean, detail: string) {
    const r = rule(id);
    if (!r.on) return;
    if (breached && !S.floorFired[id]) { S.floorFired[id] = true; fire(r, null, detail); }
    if (!breached) S.floorFired[id] = false;
  }

  function evaluate() {
    evaluateAgents(S.agents, S.rules, (r, a) => { fire(r, a); });
    // Queue rules run whenever there is queue data; a replay only has it if the import supplied it.
    const q = S.queue;
    if (q) {
      floorRule("cq", q.cq > thr("cq"), `${Math.round(q.cq)} calls waiting`);
      // No service level yet is not a breach.
      if (q.sl !== null) floorRule("sl", q.sl < thr("sl"), `SL at ${q.sl.toFixed(0)}%`);
      floorRule("aband", q.ab > thr("aband"), `abandon at ${q.ab.toFixed(1)}%`);
    }
    // A replay has no live heartbeat to watch.
    if (S.mode !== "replay") floorRule("gnr", S.staleFor >= thr("gnr"), `feed stale ${S.staleFor}s, states may be outdated`);
  }

  /** Advance the shift clock by one second. */
  function tick() {
    if (S.mode === "replay") {
      const R = S.replay!;
      if (R.done) return;
      S.t++;
      advance();
      evaluate();
      if (S.t >= R.endT) {
        R.done = true;
        toast({ kind: "info", title: "Replay complete", body: `${S.ledger.length} instances, ${S.incidents.length} incident(s) from this export. Review them in Dashboards and Instance Ledger.` });
      }
      return;
    }
    S.t++;
    const alive = beat;
    beat = false;
    if (alive) {
      S.staleFor = 0;
      advance();
    } else {
      // Feed is silent: agent states freeze and the stale counter runs. Feed status is shown
      // persistently in the ContextBar, and a sustained outage still escalates via the gnr rule,
      // so no transient "not responding" / "recovered" toast is raised here.
      S.staleFor++;
    }
    evaluate();
  }

  const find = (n: number) => S.ledger.find(r => r.n === n);
  const markAck = (r: Instance) => { r.status = "acked"; r.ackT = S.t; r.rev = ++S.rev; };

  return {
    S, ingest, tick, thr,
    /** Clear the shift (ledger, incidents, strikes) and set the clock. Rule configuration is kept. */
    reset(o: { t: number; mode?: "live" | "replay"; replay?: ReplayMeta | null }) {
      Object.assign(S, { t: o.t, mode: o.mode ?? "live", replay: o.replay ?? null, org: [], agents: [], ledger: [], incidents: [], seq: 0, incSeq: 0, staleFor: 0, queue: null, floorFired: {} });
      S.rev++;
      pending = []; pendingQueue = null; beat = false;
    },
    /** After a quiet warm-up: arm exactly the rules that are in breach right now. */
    rearm() {
      for (const a of S.agents) {
        a.fired = oncePerShift(a.fired);
        for (const r of S.rules) if (ruleApplies(r, a)) a.fired[r.id] = true;
      }
    },
    ack(n: number): Instance | null {
      const r = find(n);
      if (!r) return null;
      if (r.status === "open") markAck(r);
      return r;
    },
    /** Acknowledge every open instance in the viewer's span. Returns the count. */
    ackAll(v: View): number {
      let k = 0;
      for (const r of scopeLedger(S, v, S.ledger)) if (r.status === "open") { markAck(r); k++; }
      return k;
    },
    /** Attach the agent's reason. `ack` also acknowledges (the nudge's Send reason). */
    comment(n: number, text: string, ack: boolean): Instance | null {
      const r = find(n);
      if (!r) return null;
      r.cmt = text; r.rev = ++S.rev;
      if (ack && r.status === "open") markAck(r);
      return r;
    },
    /** Open -> Investigating -> Closed (with a disposition). */
    invAction(inc: string, disposition?: string): Incident | null {
      const i = S.incidents.find(x => x.inc === inc);
      if (!i) return null;
      if (i.status === "Open") i.status = "Investigating";
      else if (i.status === "Investigating") {
        i.disposition = disposition && DISPOSITIONS.includes(disposition) ? disposition : DISPOSITIONS[0];
        i.status = "Closed"; i.closedT = S.t;
      }
      return i;
    },
    setThr(id: RuleId, v: unknown) { const r = rule(id); r.thr = Math.max(1, parseInt(String(v), 10) || r.thr); },
    setSev(id: RuleId, v: Severity) { rule(id).sev = v === "crit" ? "crit" : "warn"; },
    setRoute(id: RuleId, v: Route) { if (ROUTE_IDS.includes(v)) rule(id).route = v; },
    setOn(id: RuleId, on: boolean) { rule(id).on = on; },
  };
}
