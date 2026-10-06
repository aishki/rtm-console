import type { AgentState, ReplayMeta, Team } from "@/lib/types";
import type { ReplayEvent } from "@/lib/csv/parse";
import type { FeedHandlers, FeedSource } from "./FeedSource";

/** Speed of a historical replay: engine seconds per wall-clock second. */
export const REPLAY_SPEED = 60;

/** Replays a Gencloud agent-status export through the engine. Carries no queue data. */
export class CsvReplayFeed implements FeedSource {
  readonly kind = "csv" as const;
  private h: FeedHandlers | null = null;
  private idx = 0;
  private last = new Map<string, AgentState>();

  /** `events` must be sorted by `t` (as returned by buildEvents). */
  constructor(private readonly events: ReplayEvent[]) {}

  /** Clock position to start from: 30 seconds before the first event. */
  get startT(): number { return Math.max(0, this.events[0].t - 30); }

  get meta(): ReplayMeta {
    return { agents: new Set(this.events.map(e => e.agent)).size, events: this.events.length, endT: this.events[this.events.length - 1].t + 600, done: false };
  }

  subscribe(handlers: FeedHandlers): () => void {
    this.h = handlers;
    const ev = this.events;
    const names = [...new Set(ev.map(e => e.agent))];
    const teams = [...new Set(ev.map(e => e.team).filter(Boolean))];
    const org: Team[] = (teams.length ? teams : ["CSV import"]).map(t => ({ team: t, tl: "TL " + t, mgr: "Imported LOB", lob: t }));
    handlers.onRoster({
      org,
      agents: names.map(n => ({ name: n, team: ev.find(e => e.agent === n && e.team)?.team || org[0].team, state: "off" as const, stTime: 0, aht: 420, calls: 0, adh: 96 })),
    });
    return () => { this.h = null; };
  }

  tick(t: number): void {
    if (!this.h) return;
    while (this.idx < this.events.length && this.events[this.idx].t <= t) {
      const e = this.events[this.idx++];
      const prev = this.last.get(e.agent) ?? "off";
      this.last.set(e.agent, e.state);
      // Leaving On Call releases the call.
      this.h.onAgentState({ agent: e.agent, state: e.state, callEnded: prev === "oncall" && e.state !== "oncall" ? {} : undefined });
    }
  }
}
