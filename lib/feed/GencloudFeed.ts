import type { FeedHandlers, FeedSource } from "./FeedSource";

export interface GencloudConfig {
  /** e.g. https://api.mypurecloud.com */
  apiBase?: string;
  clientId?: string;
  clientSecret?: string;
}

/**
 * Production adapter for the Gencloud/NiceIEX real-time API.
 *
 * Stub: the wiring below is the contract the real adapter has to meet. Until it is
 * implemented the feed stays silent, so the console shows "Gencloud not responding" and the
 * system rule fires at its threshold, which is the correct behavior for a feed that is down.
 *
 * To implement:
 *  1. Authenticate (client credentials) and load the org model (teams, TLs, managers, LOBs)
 *     and the agents on shift, then call `onRoster`.
 *  2. Open the notifications channel and subscribe to presence, routing status and
 *     conversation topics for those agents. Map each change to an `AgentStateEvent`
 *     (set `callEnded` when a conversation is released, `onHold` on hold start/end,
 *     `adh` from NiceIEX adherence).
 *  3. Poll or subscribe to queue observations and call `onQueue` with calls in queue,
 *     service level, ASA and abandon rate for the interval.
 *  4. Call `onHeartbeat` whenever the channel proves it is alive (its own heartbeat frames).
 */
export class GencloudFeed implements FeedSource {
  readonly kind = "gencloud" as const;
  private handlers: FeedHandlers | null = null;

  constructor(private readonly config: GencloudConfig = {}) {}

  subscribe(handlers: FeedHandlers): () => void {
    this.handlers = handlers;
    this.connect();
    return () => { this.handlers = null; this.disconnect(); };
  }

  private connect(): void {
    // TODO: open the Gencloud notifications channel (see the steps above).
    void this.config;
  }

  private disconnect(): void {
    // TODO: close the channel and cancel polling.
  }
}
