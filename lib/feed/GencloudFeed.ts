import type { FeedHandlers, FeedSource } from "./FeedSource";
import { GencloudClient } from "./gencloud/client";
import { mapGenesysState } from "./gencloud/state";
import { WsManager } from "./gencloud/ws";
import { buildRoster, aggregateQueue } from "./gencloud/mappers";

// Server-only: pulls in the Node `ws` module. Never import this from a client component.

export interface GencloudConfig {
  /** e.g. https://api.mypurecloud.com */
  apiBase?: string;
  token?: string;
  viewConfigId?: string;
  clientId?: string;
  clientSecret?: string;
}

const DEFAULT_API_BASE = "https://api.mypurecloud.com";
const DEFAULT_VIEW_CONFIG_ID = "9c9f8fd2-acab-4282-9442-ddba152f9c18";
const POLL_MS = 5000;

/**
 * Production adapter for Genesys Cloud (Gencloud).
 *
 * v1 gaps: no onHold / callEnded / adh events yet (they need conversation topics and WFM
 * adherence), so the AHT, short-call, transfer, hold and adherence rules stay quiet.
 *
 * Without a token the feed stays silent, so the console shows "Gencloud not responding".
 * A failed poll cycle (including 401) is skipped; missing heartbeats make the engine mark
 * the floor stale. The token is never logged.
 */
export class GencloudFeed implements FeedSource {
  readonly kind = "gencloud" as const;

  constructor(private readonly config: GencloudConfig = {}) {}

  subscribe(handlers: FeedHandlers): () => void {
    const apiBase = this.config.apiBase ?? process.env.GENCLOUD_API_BASE ?? DEFAULT_API_BASE;
    const token = this.config.token ?? process.env.GENESYS_TOKEN;
    const viewConfigId = this.config.viewConfigId ?? process.env.RTM_VIEW_CONFIG_ID ?? DEFAULT_VIEW_CONFIG_ID;

    if (!token) {
      console.warn("GencloudFeed: no GENESYS_TOKEN set; feed is silent");
      return () => {};
    }

    const client = new GencloudClient({ apiBase, token, viewConfigId });
    const ws = new WsManager(apiBase, token);
    let stopped = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let wsTeardown: (() => void) | null = null;

    const pollOnce = async (queueIds: string[]): Promise<void> => {
      try {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const [obs, agg] = await Promise.all([
          client.getObservations(queueIds),
          client.getAggregates(queueIds, { start: start.toISOString(), end: new Date().toISOString() }),
        ]);
        if (stopped) return;
        handlers.onQueue(aggregateQueue(obs, agg));
        handlers.onHeartbeat();
      } catch (e) {
        // Skip this cycle; staleness is signalled by the absence of heartbeats.
        console.warn("GencloudFeed: poll cycle failed:", e instanceof Error ? e.message : "unknown error");
      }
    };

    const bootstrap = async (): Promise<void> => {
      try {
        const queues = await client.getWatchedQueues();
        const membersByQueue: Record<string, { id: string; name: string }[]> = {};
        for (const q of queues) membersByQueue[q.id] = await client.getQueueMembers(q.id);
        if (stopped) return;
        const { org, agents, idToName } = buildRoster(queues, membersByQueue);
        handlers.onRoster({ org, agents });

        const queueIds = queues.map((q) => q.id);
        const latest: Record<string, { presence?: string; routing?: string }> = {};
        const teardown = await ws.subscribe(
          Object.keys(idToName),
          (ev) => {
            const name = idToName[ev.userId];
            if (!name) return;
            const cur = (latest[ev.userId] ??= {});
            if (ev.systemPresence !== undefined) cur.presence = ev.systemPresence;
            if (ev.routingStatus !== undefined) cur.routing = ev.routingStatus;
            const state = mapGenesysState(cur.presence, cur.routing);
            handlers.onAgentState({ agent: name, state });
          },
          handlers.onHeartbeat,
        );
        if (stopped) { teardown(); return; }
        wsTeardown = teardown;

        pollTimer = setInterval(() => { void pollOnce(queueIds); }, POLL_MS);
        void pollOnce(queueIds);
      } catch (e) {
        console.warn("GencloudFeed: bootstrap failed:", e instanceof Error ? e.message : "unknown error");
      }
    };

    void bootstrap();

    return () => {
      stopped = true;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      wsTeardown?.();
      wsTeardown = null;
    };
  }
}
