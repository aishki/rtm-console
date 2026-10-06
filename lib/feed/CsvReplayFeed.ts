import type { AgentState, Queue, ReplayMeta, RosterAgent, Team } from "@/lib/types";
import type { ReplayEvent } from "@/lib/csv/parse";
import type { FeedHandlers, FeedSource } from "./FeedSource";

/** Speed of a historical replay: engine seconds per wall-clock second. */
export const REPLAY_SPEED = 60;

/** What an imported workbook adds on top of the status timeline. All of it is optional. */
export interface ReplayExtras {
  /** Org model. Without it, teams come from the events and get placeholder leaders. */
  org?: Team[];
  /** Everyone on the floor, including agents with no status rows. */
  roster?: RosterAgent[];
  /** Hold start/end, sorted by `t`. */
  holds?: { agent: string; t: number; on: boolean }[];
  /** Queue metrics, sorted by `t`. Each holds until the next one. */
  queue?: { t: number; queue: Queue }[];
}

/**
 * Replays a day of agent statuses through the engine: a raw Gencloud status export (CSV),
 * or a filled-in floor data workbook that also brings the org, holds and queue intervals.
 */
export class CsvReplayFeed implements FeedSource {
  readonly kind = "csv" as const;
  private h: FeedHandlers | null = null;
  private idx = 0;
  private holdIdx = 0;
  private queueIdx = 0;
  private last = new Map<string, AgentState>();

  /** `events` must be sorted by `t` (as returned by buildEvents or buildFloorImport). */
  constructor(private readonly events: ReplayEvent[], private readonly extras: ReplayExtras = {}) {}

  /** Clock position to start from: 30 seconds before the first event. */
  get startT(): number { return Math.max(0, this.events[0].t - 30); }

  get meta(): ReplayMeta {
    const agents = this.extras.roster?.length ?? new Set(this.events.map(e => e.agent)).size;
    return { agents, events: this.events.length, endT: this.events[this.events.length - 1].t + 600, done: false };
  }

  subscribe(handlers: FeedHandlers): () => void {
    this.h = handlers;
    const ev = this.events;
    const teams = [...new Set(ev.map(e => e.team).filter(Boolean))];
    const org: Team[] = this.extras.org ?? (teams.length ? teams : ["CSV import"]).map(t => ({ team: t, tl: "TL " + t, mgr: "Imported LOB", lob: t }));
    const agents: RosterAgent[] = this.extras.roster ?? [...new Set(ev.map(e => e.agent))].map(n => ({
      name: n, team: ev.find(e => e.agent === n && e.team)?.team || org[0].team, state: "off" as const, stTime: 0, aht: 420, calls: 0, adh: 96,
    }));
    handlers.onRoster({ org, agents });
    return () => { this.h = null; };
  }

  tick(t: number): void {
    const h = this.h;
    if (!h) return;
    const { holds = [], queue = [] } = this.extras;
    while (this.idx < this.events.length && this.events[this.idx].t <= t) {
      const e = this.events[this.idx++];
      const prev = this.last.get(e.agent) ?? "off";
      this.last.set(e.agent, e.state);
      // Leaving On Call releases the call.
      h.onAgentState({ agent: e.agent, state: e.state, callEnded: prev === "oncall" && e.state !== "oncall" ? { transferred: e.transferred } : undefined });
    }
    while (this.holdIdx < holds.length && holds[this.holdIdx].t <= t) {
      const hold = holds[this.holdIdx++];
      // A hold only means something while the agent is on a call.
      if (this.last.get(hold.agent) === "oncall") h.onAgentState({ agent: hold.agent, state: "oncall", onHold: hold.on });
    }
    while (this.queueIdx < queue.length && queue[this.queueIdx].t <= t) h.onQueue({ ...queue[this.queueIdx++].queue });
  }
}
