import type { InitMsg, TickMsg, View } from "@/lib/types";
import { PERMS, inScope, peopleDirectory, scopeAgents, scopeIncidents, scopeLedger, scopeTeams } from "@/lib/engine/scope";
import { queueMapRev, loadQueueMap } from "./queueMapStore";
import { SimFeed } from "@/lib/feed/SimFeed";
import type { Batch, Runtime } from "./runtime";
import { VIEW_AS } from "./session";

/** What a subscriber already has: the ledger revision, the roster it got members from, and the mapping revision. */
export interface Since { rev: number; rosterRev: number; mapRev: number }

/** What a subscriber has after receiving the engine's current state. */
export const sinceNow = (rt: Runtime): Since => ({ rev: rt.engine.S.rev, rosterRev: rt.engine.S.rosterRev, mapRev: queueMapRev() });

/**
 * Everything one viewer is allowed to see, scoped server-side. `since` limits the ledger to
 * instances changed after its revision, and leaves out the membership and mapping it already
 * has (null sends the whole scoped ledger, membership and mapping).
 */
export function tickMsg(rt: Runtime, view: View, since: Since | null, batch: Batch): TickMsg {
  const S = rt.engine.S;
  const replay = S.mode === "replay";
  const leader = view.role !== "agent";
  const ledger = scopeLedger(S, view, S.ledger);
  const agents = scopeAgents(S, view);
  let members: Record<string, number[]> | undefined;
  if (!since || since.rosterRev !== S.rosterRev) {
    const mine = new Set(agents.map(a => a.id));
    members = Object.fromEntries(Object.entries(S.members ?? {}).map(([q, ids]) => [q, ids.filter(id => mine.has(id))]));
  }
  return {
    type: "tick", t: S.t, mode: S.mode, staleFor: S.staleFor, agentsLoading: S.agentsLoading, replay: S.replay, queue: S.queue, rules: S.rules,
    org: scopeTeams(S, view), agents, incidents: scopeIncidents(S, view, S.incidents),
    ledger: since === null ? ledger : ledger.filter(r => r.rev > since.rev),
    queues: S.queues ?? {}, members,
    queueMap: !since || since.mapRev !== queueMapRev() ? loadQueueMap() : undefined,
    // Call-out toasts go to the leaders whose span they are in; feed notices go to everyone.
    // A replay only announces its own progress.
    toasts: batch.toasts
      .filter(e => (replay ? e.kind === "info" : !e.instance || (leader && inScope(S, view, e.instance))))
      .map(({ kind, title, body, instance }) => ({ kind, title, body, n: instance?.n, team: instance && !instance.isFloor ? instance.team : undefined })),
    // A nudge is private: it goes to the agent it is about and to nobody else.
    nudges: replay || leader ? [] : batch.nudges.filter(n => n.agent === view.who),
  };
}

/** True for a simulation that carries real team and agent names. */
export const usesRealNames = (rt: Runtime): boolean => rt.feed instanceof SimFeed && rt.feed.seed.real;

export function initMsg(rt: Runtime, view: View): InitMsg {
  const S = rt.engine.S;
  // A nudge that arrived while the agent's console was closed (they may have come from the desktop alert).
  const waiting = view.role === "agent" && view.who ? rt.pendingNudge(view.who) : null;
  return {
    ...tickMsg(rt, view, null, { toasts: [], nudges: waiting ? [waiting] : [] }),
    type: "init", view, people: VIEW_AS ? peopleDirectory(S) : null,
    feed: rt.feed.kind, realNames: usesRealNames(rt), genesysOrg: rt.genesysOrg ?? null, canSwitchFeed: PERMS[view.role].feed,
  };
}
