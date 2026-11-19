import type { Agent, AgentView, InitMsg, TickMsg, View } from "@/lib/types";
import { toView } from "@/lib/agentTimes";
import { PERMS, inScope, leadersOf, peopleDirectory, scopeAgents, scopeIncidents, scopeLedger, scopeTeams, unsupervised, viewerName } from "@/lib/engine/scope";
import { queueMapRev, loadQueueMap } from "./queueMapStore";
import { SimFeed } from "@/lib/feed/SimFeed";
import type { Batch, Runtime } from "./runtime";
import { VIEW_AS } from "./session";
import { canCue, cueAgentName, isDemoPresenter } from "./demo";

/** What a subscriber already has: the ledger revision, the roster it got members from, and the mapping revision. */
export interface Since { rev: number; rosterRev: number; mapRev: number }

/** What a subscriber has after receiving the engine's current state. */
export const sinceNow = (rt: Runtime): Since => ({ rev: rt.engine.S.rev, rosterRev: rt.engine.S.rosterRev, mapRev: queueMapRev() });

/** What one subscriber was last sent, so a tick can leave out what has not changed. One per stream connection. */
export interface Sent {
  /** Each agent's wire form as last sent, by id. */
  agents: Map<number, string>;
  rules?: string; incidents?: string; org?: string; queues?: string;
}
export const newSent = (): Sent => ({ agents: new Map() });

interface Wire { view: AgentView; key: string }
/** Each agent's wire form, worked out once per publish and shared by every subscriber. */
const wireCache = new WeakMap<Batch, Map<Agent, Wire>>();
const jsonCache = new WeakMap<Batch, { rules: string; queues: string }>();

function wireOf(cache: Map<Agent, Wire>, a: Agent, t: number): Wire {
  let w = cache.get(a);
  if (!w) {
    const view = toView(a, t);
    w = { view, key: JSON.stringify(view) };
    cache.set(a, w);
  }
  return w;
}

/** The scoped agents for this subscriber: all of them, or only those that changed since `sent`. */
function agentDelta(agents: Agent[], t: number, batch: Batch, sent: Sent | undefined, full: boolean): Pick<TickMsg, "agents" | "agentsChanged"> {
  let cache = wireCache.get(batch);
  if (!cache) wireCache.set(batch, (cache = new Map()));
  const wires = agents.map(a => wireOf(cache, a, t));
  const record = (w: Wire) => sent?.agents.set(w.view.id, w.key);
  // The span changed (a roster reload, a different set of people): start over with the whole list.
  if (!sent || full || sent.agents.size !== wires.length || wires.some(w => !sent.agents.has(w.view.id))) {
    sent?.agents.clear();
    wires.forEach(record);
    return { agents: wires.map(w => w.view) };
  }
  const changed: AgentView[] = [];
  for (const w of wires) {
    if (sent.agents.get(w.view.id) !== w.key) {
      changed.push(w.view);
      record(w);
    }
  }
  return changed.length ? { agentsChanged: changed } : {};
}

/**
 * Everything one viewer is allowed to see, scoped server-side. `since` limits the ledger to
 * instances changed after its revision, and leaves out the membership and mapping it already
 * has (null sends the whole scoped ledger, membership and mapping). With `sent`, agents,
 * incidents, rules, org and queue counts are sent only when they differ from what it records.
 */
export function tickMsg(rt: Runtime, view: View, since: Since | null, batch: Batch, sent?: Sent): TickMsg {
  const S = rt.engine.S;
  const replay = S.mode === "replay";
  const leader = view.role !== "agent";
  // On the demo floor the presenter sees the cue agent's nudges, and only the cue agent's call-outs pop up as toasts.
  const presenter = isDemoPresenter(rt, PERMS[view.role]);
  const cued = (agentId: string | null | undefined) => presenter && !!agentId && isDemoPresenter(rt, PERMS[view.role], { agentId });
  const ledger = scopeLedger(S, view, S.ledger);
  const agents = scopeAgents(S, view);
  let json = jsonCache.get(batch);
  if (!json) jsonCache.set(batch, (json = { rules: JSON.stringify(S.rules), queues: JSON.stringify(S.queues ?? {}) }));
  /** The value when this subscriber does not have it yet, else undefined. */
  const ifChanged = <T,>(field: "rules" | "incidents" | "org" | "queues", value: T, text = JSON.stringify(value)): T | undefined => {
    if (sent && since && sent[field] === text) return undefined;
    if (sent) sent[field] = text;
    return value;
  };
  let members: Record<string, number[]> | undefined;
  let leads: TickMsg["leads"];
  let noSupervisor: number | undefined, manyLobs: number | undefined;
  if (!since || since.rosterRev !== S.rosterRev) {
    const mine = new Set(agents.map(a => a.id));
    members = Object.fromEntries(Object.entries(S.members ?? {}).map(([q, ids]) => [q, ids.filter(id => mine.has(id))]));
    if (PERMS[view.role].mapping) { noSupervisor = unsupervised(S).length; manyLobs = S.severalLobs.length; }
    leads = Object.fromEntries(agents.map(a => { const l = leadersOf(S.people, a.uid); return [a.uid, { tl: l.tl?.name ?? null, mgr: l.mgr?.name ?? null }]; }));
  }
  return {
    type: "tick", t: S.t, agentT: S.agentT, mode: S.mode, staleFor: S.staleFor, agentsLoading: S.agentsLoading, replay: S.replay, queue: S.queue,
    rules: ifChanged("rules", S.rules, json.rules),
    org: ifChanged("org", scopeTeams(S, view)),
    ...agentDelta(agents, S.agentT, batch, sent, !since || since.rosterRev !== S.rosterRev),
    incidents: ifChanged("incidents", scopeIncidents(S, view, S.incidents)),
    ledger: since === null ? ledger : ledger.filter(r => r.rev > since.rev),
    queues: ifChanged("queues", S.queues ?? {}, json.queues), members, leads, unsupervised: noSupervisor, severalLobs: manyLobs, viewerName: viewerName(view, S),
    queueMap: !since || since.mapRev !== queueMapRev() ? loadQueueMap() : undefined,
    // Call-out toasts go to the leaders whose span they are in; feed notices go to everyone.
    // A replay only announces its own progress.
    toasts: batch.toasts
      .filter(e => (replay ? e.kind === "info" : !e.instance || (leader && inScope(S, view, e.instance) && (!presenter || cued(e.instance.agentId)))))
      .map(({ kind, title, body, instance }) => ({ kind, title, body, n: instance?.n, team: instance && !instance.isFloor ? instance.team : undefined })),
    // A nudge is private: it goes to the agent it is about and to nobody else.
    nudges: replay ? [] : presenter ? batch.nudges.filter(n => cued(n.agentId)) : leader ? [] : batch.nudges.filter(n => n.agentId === view.who),
  };
}

/** True for a simulation that carries real team and agent names. */
export const usesRealNames = (rt: Runtime): boolean => rt.feed instanceof SimFeed && rt.feed.seed.real;

/** The first message on a connection. `sent` starts recording what the connection has from here. */
export function initMsg(rt: Runtime, view: View, sent?: Sent): InitMsg {
  const S = rt.engine.S;
  // A nudge that arrived while the agent's console was closed (they may have come from the desktop alert).
  const waiting = view.role === "agent" && view.who ? rt.pendingNudge(view.who) : null;
  return {
    ...tickMsg(rt, view, null, { toasts: [], nudges: waiting ? [waiting] : [] }, sent),
    type: "init", view, people: VIEW_AS ? peopleDirectory(S) : null,
    feed: rt.feed.kind, realNames: usesRealNames(rt), genesysOrg: rt.genesysOrg ?? null, canSwitchFeed: PERMS[view.role].feed,
    cueAgent: canCue(rt, PERMS[view.role], VIEW_AS) ? cueAgentName(rt) : null,
    canCue: canCue(rt, PERMS[view.role], VIEW_AS),
  };
}
