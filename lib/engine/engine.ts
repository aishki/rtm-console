import type { Agent, AgentStateEvent, AgentStats, Incident, Instance, InvAction, Place, Queue, QueueCounts, ReplayMeta, Roster, Route, Rule, RuleId, Severity, View } from "@/lib/types";
import type { QueueMapRow } from "@/lib/import/queueMap";
import { queueKey, rollUp } from "@/lib/queueStats";
import type { FeedHandlers } from "@/lib/feed/FeedSource";
import { DISPOSITIONS, ONCE_PER_SHIFT, canClose, ROUTE_IDS, defaultRules, evaluateAgents, ruleApplies, ruleOf, thrOf } from "./rules";
import { type EngineHooks, type EngineState, type IncidentCounter, fire as fireRule, incidentCounter } from "./escalation";
import { scopeLedger } from "./scope";
import { type OverridePatch, overrideAt, patchOverride, placeAgents, placeKey, queueKeysUnder, ruleFor } from "./overrides";
import { type AckVia, type Recorder, type SavedFloor, firedKeys, readFiredKeys } from "./record";

export interface EngineOptions {
  /** Share a rule set between engines (live and replay read the same configuration). */
  rules?: Rule[];
  /** Model adherence drift from state time when the feed does not supply adherence. */
  deriveAdh?: boolean;
  /** Incident numbers shared with other engines (the Genesys orgs' floors). Without it, the engine numbers its own from 1 and a reset starts again. */
  incidents?: IncidentCounter;
  /** The year an engine's own incident numbers use. The floor's year unless a test fixes it. */
  year?: () => number;
  /** The WFM queue-to-LOB mapping for this floor, and its revision: it places agents and queues for rule overrides. */
  mapping?: () => { rev: number; rows: QueueMapRow[] };
  /** Told of every call-out, acknowledgement, reason and incident move, to keep them. Without it nothing is kept. */
  record?: Recorder;
  /**
   * Call-out numbers shared with other engines (the Genesys orgs' floors): the last one handed out.
   * They are the saved call-outs' IDs, so they never repeat. Without it the engine numbers its own from 1.
   */
  ids?: { n: number };
}

type QueueRuleId = "cq" | "sl" | "aband";
/** Each queue rule's test on a set of numbers: in breach, and what to say. Null when there is nothing to judge. */
const QUEUE_TESTS: Record<QueueRuleId, (q: Queue, thr: number) => [boolean, string] | null> = {
  cq: (q, thr) => [q.cq > thr, `${Math.round(q.cq)} calls waiting`],
  // No service level yet is not a breach.
  sl: (q, thr) => (q.sl === null ? null : [q.sl < thr, `SL at ${q.sl.toFixed(0)}%`]),
  aband: (q, thr) => [q.ab > thr, `abandon at ${q.ab.toFixed(1)}%`],
};
const QUEUE_RULES = Object.keys(QUEUE_TESTS) as QueueRuleId[];

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
    ledger: [], incidents: [], seq: 0, staleFor: 0, agentsLoading: false, quiet: false, queue: null, queues: {}, members: {}, people: {}, rosterRev: 0, floorFired: {}, groupFired: {}, severalLobs: [], rev: 0,
  };
  /** The mapping and roster the agents were last placed from, and each override's queues under that mapping. */
  let placed = { mapRev: -1, rosterRev: -1 };
  let mapRows: QueueMapRow[] = [];
  let groupQueues = new Map<string, Set<string>>();
  let beat = false;
  let pending: AgentStateEvent[] = [];
  let pendingQueue: Queue | null = null;
  let pendingQueues: Record<string, QueueCounts> | null = null;
  let pendingStats: AgentStats[] = [];
  let counter = opts.incidents ?? incidentCounter(undefined, opts.year);
  /** Today's strikes from before a restart, by uid, for agents the roster has not brought back yet. */
  let carried: SavedFloor["strikes"] = {};
  /** Today's calls from before a restart, by uid, likewise. */
  let carriedCalls: NonNullable<SavedFloor["calls"]> = {};
  /** The rules in breach as last told to the recorder. */
  let firedSaid = "";

  const thr = (id: RuleId) => thrOf(S.rules, id);
  const rule = (id: RuleId) => ruleOf(S.rules, id);
  const toast: NonNullable<EngineHooks["toast"]> = e => { if (!S.quiet) hooks.toast?.(e); };
  const fire = (r: Rule, a: Agent | null, detail?: string, group?: Place) => {
    if (opts.ids) S.seq = opts.ids.n;
    const rec = fireRule(S, { toast, nudge: hooks.nudge }, counter, r, a, detail, group);
    if (opts.ids) opts.ids.n = S.seq;
    opts.record?.fired(rec, { thr: r.thr, overrideAt: overrideAt(rule(r.id), rec.place), incident: rec.inc ? S.incidents.find(i => i.inc === rec.inc) ?? null : null });
    return rec;
  };

  /** Place each agent in a LOB when the roster or the mapping changed. */
  function syncPlaces() {
    const m = opts.mapping?.();
    if (!m || (m.rev === placed.mapRev && S.rosterRev === placed.rosterRev)) return;
    if (m.rev !== placed.mapRev) { mapRows = m.rows; groupQueues = new Map(); }
    placed = { mapRev: m.rev, rosterRev: S.rosterRev };
    const { places, severalLobs } = placeAgents(mapRows, S.members);
    for (const a of S.agents) { const p = places.get(a.id); if (p) a.place = p; else delete a.place; }
    const uidOf = new Map(S.agents.map(a => [a.id, a.uid]));
    S.severalLobs = severalLobs.flatMap(({ id, lobs }) => { const uid = uidOf.get(id); return uid ? [{ uid, lobs }] : []; });
  }

  const ingest: FeedHandlers = {
    /** A roster resent mid-shift (the feed reconnected) keeps each known agent's shift counters and strikes. */
    onRoster(r: Roster) {
      const prev = new Map(S.agents.map(a => [a.uid, a]));
      S.org = r.org.map(t => ({ ...t }));
      S.agents = r.agents.map((a, i) => {
        const p = prev.get(a.uid);
        const c = carriedCalls[a.uid];
        return {
          id: i, uid: a.uid, name: a.name, team: a.team, state: a.state, stTime: a.stTime ?? 0, onHold: false, holdTime: 0,
          aht: p?.aht ?? c?.aht ?? a.aht ?? 420, calls: p?.calls ?? c?.calls ?? a.calls ?? 0, shortCalls: p?.shortCalls ?? c?.shortCalls ?? 0, transfers: p?.transfers ?? c?.transfers ?? 0,
          adh: p?.adh ?? a.adh ?? 96, ahtFromFeed: p?.ahtFromFeed, strikes: { ...(p?.strikes ?? carried[a.uid]) }, fired: { ...p?.fired },
          ...(p?.place && { place: p.place }),
        };
      });
      const ids = new Map(S.agents.map(a => [a.uid, a.id]));
      // Without membership from the feed (simulator, replay), a team's members are the agents whose team it is.
      const byUid = r.members ?? Object.fromEntries(S.org.map(t => [t.team, S.agents.filter(a => a.team === t.team).map(a => a.uid)]));
      S.members = Object.fromEntries(Object.entries(byUid).map(([q, uids]) => [q, uids.flatMap(u => ids.get(u) ?? [])]));
      // A roster without reporting lines keeps the ones already known (they arrive after it from Genesys).
      if (r.people) S.people = Object.fromEntries(r.people.map(p => [p.uid, { name: p.name, supervisor: p.supervisor }]));
      S.rosterRev++;
      beat = true;
    },
    onPeople(people) {
      for (const p of people) S.people[p.uid] = { name: p.name, supervisor: p.supervisor };
      S.rosterRev++;
    },
    onAgentState(e) { pending.push(e); beat = true; },
    onQueue(q, byQueue) { pendingQueue = q; if (byQueue) pendingQueues = byQueue; beat = true; },
    onAgentStats(s) { pendingStats.push(...s); beat = true; },
    onAgentsLoading(loading) { S.agentsLoading = loading; },
    onHeartbeat() { beat = true; },
  };

  function applyAgentState(e: AgentStateEvent) {
    const a = S.agents.find(x => x.uid === e.uid);
    if (!a) return;
    if (e.callEnded) {
      const dur = e.callEnded.durationSec !== undefined ? Math.round(e.callEnded.durationSec) : a.stTime;
      a.calls++;
      // A replay has no AHT baseline, so the first call seeds it. AHT from the feed is the real figure: keep it.
      if (!a.ahtFromFeed) a.aht = S.mode === "replay" && a.calls === 1 ? dur : Math.round(a.aht * 0.85 + dur * 0.15);
      if (e.callEnded.transferred) a.transfers++;
      const short = ruleFor(rule("short"), a.place);
      if (short.on && dur < short.thr) { a.shortCalls++; fire(short, a, `${dur}s call`); }
    }
    if (e.state !== a.state) {
      if (a.state === "oncall") { a.onHold = false; a.holdTime = 0; }
      a.state = e.state; a.stTime = 0; a.fired = oncePerShift(a.fired);
    }
    if (e.elapsed !== undefined) a.stTime = Math.max(0, Math.round(e.elapsed));
    if (e.onHold !== undefined && e.onHold !== a.onHold) { a.onHold = e.onHold; a.holdTime = 0; }
    if (a.onHold && e.holdElapsed !== undefined) a.holdTime = Math.max(0, Math.round(e.holdElapsed));
    if (e.adh !== undefined) a.adh = e.adh;
    // Last, once state, timers and hold are all set: rules already past at connect raise nothing.
    if (e.seed) for (const r of S.rules) if (ruleApplies(r, a)) a.fired[r.id] = true;
  }

  function advance() {
    for (const a of S.agents) {
      a.stTime++;
      if (a.onHold) a.holdTime++;
    }
    for (const e of pending) applyAgentState(e);
    pending = [];
    for (const s of pendingStats) {
      const a = S.agents.find(x => x.uid === s.uid);
      if (a) { a.aht = Math.round(s.aht); a.ahtFromFeed = true; }
    }
    pendingStats = [];
    if (pendingQueue) { S.queue = pendingQueue; pendingQueue = null; }
    if (pendingQueues) { S.queues = pendingQueues; pendingQueues = null; }
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

  /**
   * Queue rules for each Tower, Sub-Tower and LOB with an override, against that group's numbers
   * rolled up by calls. Each fires once per breach and re-arms on recovery, like the floor's.
   */
  function groupRules() {
    const names = Object.keys(S.queues);
    if (!names.length || !mapRows.length) return;
    for (const id of QUEUE_RULES) {
      const base = rule(id);
      for (const o of base.overrides ?? []) {
        const key = `${id}|${placeKey(o)}`;
        const r = ruleFor(base, o);
        if (!r.on) { S.groupFired[key] = false; continue; }
        let keys = groupQueues.get(placeKey(o));
        if (!keys) groupQueues.set(placeKey(o), (keys = queueKeysUnder(mapRows, o)));
        const under = keys;
        const q = rollUp(names.filter(n => under.has(queueKey(n))).map(n => S.queues[n]));
        const test = q && QUEUE_TESTS[id](q, r.thr);
        if (!test) continue;
        const [breached, detail] = test;
        if (breached && !S.groupFired[key]) { S.groupFired[key] = true; fire(r, null, detail, { tower: o.tower, subTower: o.subTower, lob: o.lob }); }
        if (!breached) S.groupFired[key] = false;
      }
    }
  }

  function evaluate() {
    evaluateAgents(S.agents, S.rules, (r, a) => { fire(r, a); });
    // Queue rules run whenever there is queue data; a replay only has it if the import supplied it.
    // The whole floor is checked against each rule's default.
    const q = S.queue;
    if (q) for (const id of QUEUE_RULES) {
      const test = QUEUE_TESTS[id](q, thr(id));
      if (test) floorRule(id, ...test);
    }
    groupRules();
    // A replay has no live heartbeat to watch.
    if (S.mode !== "replay") floorRule("gnr", S.staleFor >= thr("gnr"), `feed stale ${S.staleFor}s, states may be outdated`);
    if (opts.record) {
      const keys = firedKeys(S.floorFired, S.groupFired);
      if (keys.join(",") !== firedSaid) { firedSaid = keys.join(","); opts.record.floorFired(keys); }
    }
  }

  /** Advance the shift clock by one second. */
  function tick() {
    syncPlaces();
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
      Object.assign(S, { t: o.t, mode: o.mode ?? "live", replay: o.replay ?? null, org: [], agents: [], ledger: [], incidents: [], seq: 0, staleFor: 0, agentsLoading: false, queue: null, queues: {}, members: {}, people: {}, floorFired: {}, groupFired: {}, severalLobs: [] });
      placed = { mapRev: -1, rosterRev: -1 };
      S.rev++;
      pending = []; pendingQueue = null; pendingQueues = null; pendingStats = []; beat = false;
      if (!opts.incidents) counter = incidentCounter(undefined, opts.year);
      carried = {}; carriedCalls = {}; firedSaid = "";
    },
    /**
     * Carry on from a floor's saved records after a restart, right after reset(): its call-outs and
     * incidents, and, when they are for `today`, the strikes and the rules in breach, so neither
     * starts again at zero nor raises a call-out twice, and today's calls, transfers and short calls.
     * Agents get their strikes and calls as the roster brings them.
     */
    restore(saved: SavedFloor, today: string) {
      S.ledger = saved.ledger.map(r => ({ ...r, rev: ++S.rev }));
      S.incidents = saved.incidents.map(i => ({ ...i }));
      S.seq = Math.max(S.seq, ...S.ledger.map(r => r.n));
      if (saved.date !== today) return;
      carried = saved.strikes;
      carriedCalls = saved.calls ?? {};
      for (const a of S.agents) {
        if (carried[a.uid]) a.strikes = { ...carried[a.uid] };
        const c = carriedCalls[a.uid];
        if (c) Object.assign(a, { calls: c.calls, transfers: c.transfers, shortCalls: c.shortCalls }, c.aht !== null && !a.ahtFromFeed && { aht: c.aht });
      }
      const { floor, groups } = readFiredKeys(saved.floorFired);
      for (const id of floor) S.floorFired[id] = true;
      for (const g of groups) S.groupFired[`${g.id}|${placeKey(g.place)}`] = true;
      firedSaid = firedKeys(S.floorFired, S.groupFired).join(",");
    },
    /**
     * Midnight on the floor's clock: a new day. Strikes and the day's counters start again at zero
     * and the clock is set to `t`. Call-outs and incidents carry over, open ones included, until
     * someone acknowledges or closes them. A breach still running at midnight raises nothing new.
     */
    newDay(t: number) {
      S.t = t;
      carried = {}; carriedCalls = {};
      for (const a of S.agents) {
        a.strikes = {}; a.calls = 0; a.shortCalls = 0; a.transfers = 0; a.fired = {};
        for (const r of S.rules) if (ruleApplies(r, a)) a.fired[r.id] = true;
      }
      S.rev++;
    },
    /** After a quiet warm-up: arm exactly the rules that are in breach right now. */
    rearm() {
      for (const a of S.agents) {
        a.fired = oncePerShift(a.fired);
        for (const r of S.rules) if (ruleApplies(r, a)) a.fired[r.id] = true;
      }
    },
    /** Acknowledge one call-out. `by` is who did it, and as what role. */
    ack(n: number, by: View | null = null, via: AckVia = "console"): Instance | null {
      const r = find(n);
      if (!r) return null;
      if (r.status === "open") { markAck(r); opts.record?.acked([r], by, via); }
      return r;
    },
    /** Acknowledge every open instance in the viewer's span. Returns the count. */
    ackAll(v: View): number {
      const done: Instance[] = [];
      for (const r of scopeLedger(S, v, S.ledger)) if (r.status === "open") { markAck(r); done.push(r); }
      if (done.length) opts.record?.acked(done, v, "ack_all");
      return done.length;
    },
    /** Attach the agent's reason. `ack` also acknowledges (the nudge's Send reason). */
    comment(n: number, text: string, ack: boolean): Instance | null {
      const r = find(n);
      if (!r) return null;
      r.cmt = text; r.rev = ++S.rev;
      opts.record?.commented(r);
      if (ack && r.status === "open") { markAck(r); opts.record?.acked([r], r.agentId ? { role: "agent", who: r.agentId } : null, "console"); }
      return r;
    },
    /**
     * Open -> Investigating -> Closed. An investigation can go back to Open, which drops its disposition,
     * and closes only once a disposition is recorded. A step that does not fit the status changes nothing.
     */
    invAction(inc: string, action: InvAction, disposition?: string, by: View | null = null): Incident | null {
      const i = S.incidents.find(x => x.inc === inc);
      if (!i) return null;
      const was = `${i.status}|${i.disposition}`;
      if (i.status === "Open") { if (action === "start") i.status = "Investigating"; }
      else if (i.status !== "Investigating") return i;
      else if (action === "reopen") { i.status = "Open"; i.disposition = ""; }
      else if (action === "record") { if (disposition && DISPOSITIONS.includes(disposition)) i.disposition = disposition; }
      else if (action === "close" && canClose(i.disposition)) { i.status = "Closed"; i.closedT = S.t; }
      if (`${i.status}|${i.disposition}` !== was) opts.record?.incidentMoved(i, action, by);
      return i;
    },
    setThr(id: RuleId, v: unknown) { const r = rule(id); r.thr = Math.max(1, parseInt(String(v), 10) || r.thr); },
    setSev(id: RuleId, v: Severity) { rule(id).sev = v === "crit" ? "crit" : "warn"; },
    setRoute(id: RuleId, v: Route) { if (ROUTE_IDS.includes(v)) rule(id).route = v; },
    setOn(id: RuleId, on: boolean) { rule(id).on = on; },
    /**
     * Change a rule's override for a Tower, Sub-Tower or LOB; null in a setting takes it back to the
     * level above. Returns the override, or null once it sets nothing. System rules take none.
     */
    setOverride(id: RuleId, place: Place, patch: OverridePatch) {
      const r = rule(id);
      if (r.type === "system") throw new Error("A system rule has no overrides.");
      const clean: OverridePatch = {};
      if (patch.thr !== undefined) clean.thr = patch.thr === null ? null : Math.max(1, Math.round(patch.thr));
      if (patch.sev !== undefined) clean.sev = patch.sev === null ? null : patch.sev === "crit" ? "crit" : "warn";
      if (patch.route !== undefined && (patch.route === null || ROUTE_IDS.includes(patch.route))) clean.route = patch.route;
      if (patch.on !== undefined) clean.on = patch.on;
      return patchOverride(r, place, clean);
    },
  };
}
