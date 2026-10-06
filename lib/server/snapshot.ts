import type { InitMsg, TickMsg, View } from "@/lib/types";
import { inScope, peopleDirectory, scopeAgents, scopeIncidents, scopeLedger, scopeTeams } from "@/lib/engine/scope";
import type { Batch, Runtime } from "./runtime";
import { VIEW_AS } from "./session";

/**
 * Everything one viewer is allowed to see, scoped server-side. `sinceRev` limits the ledger
 * to instances changed after that revision (null sends the whole scoped ledger).
 */
export function tickMsg(rt: Runtime, view: View, sinceRev: number | null, batch: Batch): TickMsg {
  const S = rt.engine.S;
  const replay = S.mode === "replay";
  const leader = view.role !== "agent";
  const ledger = scopeLedger(S, view, S.ledger);
  return {
    type: "tick", t: S.t, mode: S.mode, staleFor: S.staleFor, replay: S.replay, queue: S.queue, rules: S.rules,
    org: scopeTeams(S, view), agents: scopeAgents(S, view), incidents: scopeIncidents(S, view, S.incidents),
    ledger: sinceRev === null ? ledger : ledger.filter(r => r.rev > sinceRev),
    // Call-out toasts go to the leaders whose span they are in; feed notices go to everyone.
    // A replay only announces its own progress.
    toasts: batch.toasts
      .filter(e => (replay ? e.kind === "info" : !e.instance || (leader && inScope(S, view, e.instance))))
      .map(({ kind, title, body }) => ({ kind, title, body })),
    // An agent only ever sees their own nudges; leaders get a preview for their span.
    nudges: replay || view.role === "senior" ? [] : batch.nudges.filter(n => inScope(S, view, { agent: n.agent, team: n.team, isFloor: false })),
  };
}

export function initMsg(rt: Runtime, view: View): InitMsg {
  const S = rt.engine.S;
  return {
    ...tickMsg(rt, view, null, { toasts: [], nudges: [] }),
    type: "init", view, people: VIEW_AS ? peopleDirectory(S) : null,
  };
}
