import type { AgentStateEvent, AgentStats, Queue, Roster } from "@/lib/types";

export interface FeedHandlers {
  /** Org model and the agents on shift. Replaces the engine's floor. */
  onRoster(roster: Roster): void;
  onAgentState(event: AgentStateEvent): void;
  onQueue(queue: Queue): void;
  /** Agents' figures for the day, when the feed reports them (Gencloud); they replace the engine's estimates. */
  onAgentStats?(stats: AgentStats[]): void;
  /** Proof of life. The engine treats a second without any feed activity as stale. */
  onHeartbeat(): void;
}

/**
 * Where agent states, queue metrics and heartbeats come from. The engine never knows which
 * adapter is behind this: Gencloud or the simulator on the live floor, a CSV during replay.
 */
export interface FeedSource {
  readonly kind: "gencloud" | "sim" | "csv";
  /** Start delivering to the handlers. Returns an unsubscribe function. */
  subscribe(handlers: FeedHandlers): () => void;
  /**
   * Clock-driven feeds (simulator, CSV replay) emit what happened during engine second `t`.
   * Push feeds (Gencloud) deliver on their own schedule and leave this out.
   */
  tick?(t: number): void;
}
