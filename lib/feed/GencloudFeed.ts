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
const BOOTSTRAP_MAX_ATTEMPTS = 5;
const BOOTSTRAP_BASE_DELAY_MS = 2000;
const BOOTSTRAP_MAX_DELAY_MS = 30000;
// Queues in this view can have hundreds of members each; fetch rosters concurrently so the
// agent grid loads in tens of seconds rather than many minutes of sequential paging. Kept low
// (with the client's 429 retry) so the member burst stays under Genesys's rate limit.
const MEMBER_CONCURRENCY = 8;

/**
 * Production adapter for Genesys Cloud (Gencloud).
 *
 * The queue poll (calls-in-queue, ASA, abandon + heartbeats) starts as soon as the watched
 * queue IDs are known, independently of the roster — so the KPI cards and "live" state do not
 * wait on loading members for every queue. The roster (agents) and the presence/routing
 * WebSocket load in the background; a slow or failed roster never stops the queue poll.
 *
 * v1 gaps: no onHold / callEnded / adh events yet (they need conversation topics and WFM
 * adherence), so the AHT, short-call, transfer, hold and adherence rules stay quiet. Real-time
 * service level is not an observation metric, so the service-level KPI is not populated here.
 *
 * Without a token the feed stays silent, so the console shows "Gencloud not responding". A
 * failed poll cycle (including 401) is skipped; missing heartbeats make the engine mark the
 * floor stale. The token is never logged.
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
    let pollStarted = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let wsTeardown: (() => void) | null = null;

    const errMsg = (e: unknown): string => (e instanceof Error ? e.message : "unknown error");
    // A 401 means a bad/expired token: retrying cannot help, so it is terminal.
    const isAuthError = (e: unknown): boolean => errMsg(e).includes("401");
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => { retryTimer = setTimeout(resolve, ms); });

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
        console.warn("GencloudFeed: poll cycle failed:", errMsg(e));
      }
    };

    /** Start the queue poll once; it only needs the queue IDs, not the roster. */
    const startPoll = (queueIds: string[]): void => {
      if (pollStarted || stopped) return;
      pollStarted = true;
      pollTimer = setInterval(() => { void pollOnce(queueIds); }, POLL_MS);
      void pollOnce(queueIds);
    };

    /** Fetch members for every queue with bounded concurrency; one bad queue is skipped. */
    const fetchAllMembers = async (queues: { id: string; name: string }[]): Promise<Record<string, { id: string; name: string }[]>> => {
      const membersByQueue: Record<string, { id: string; name: string }[]> = {};
      let next = 0;
      const worker = async (): Promise<void> => {
        while (!stopped) {
          const i = next++;
          if (i >= queues.length) return;
          const q = queues[i];
          try {
            membersByQueue[q.id] = await client.getQueueMembers(q.id);
          } catch (e) {
            if (isAuthError(e)) throw e;
            console.warn(`GencloudFeed: failed to load members for queue ${q.id}, skipping`);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(MEMBER_CONCURRENCY, queues.length) }, worker));
      return membersByQueue;
    };

    /** Load the roster and open the presence/routing WebSocket. Runs in the background; a
     *  failure here is logged and never stops the queue poll. */
    const loadRosterAndSubscribe = async (queues: { id: string; name: string }[]): Promise<void> => {
      try {
        const membersByQueue = await fetchAllMembers(queues);
        if (stopped) return;
        const { org, agents, idToName } = buildRoster(queues, membersByQueue);
        handlers.onRoster({ org, agents });
        if (Object.keys(idToName).length === 0) {
          console.warn("GencloudFeed: roster is empty (no queue members loaded)");
          return;
        }
        const latest: Record<string, { presence?: string; routing?: string }> = {};
        const teardown = await ws.subscribe(
          Object.keys(idToName),
          (ev) => {
            const name = idToName[ev.userId];
            if (!name) return;
            const cur = (latest[ev.userId] ??= {});
            if (ev.systemPresence !== undefined) cur.presence = ev.systemPresence;
            if (ev.routingStatus !== undefined) cur.routing = ev.routingStatus;
            handlers.onAgentState({ agent: name, state: mapGenesysState(cur.presence, cur.routing) });
          },
          handlers.onHeartbeat,
        );
        if (stopped) { teardown(); return; }
        wsTeardown = teardown;
      } catch (e) {
        if (isAuthError(e)) console.warn("GencloudFeed: roster/WS load failed with 401 (check GENESYS_TOKEN)");
        else console.warn("GencloudFeed: roster/WS load failed:", errMsg(e));
      }
    };

    /** Resolve the watched queues, then start the poll immediately and load the roster in the
     *  background. Throws only on a getWatchedQueues failure (handled by the retry loop). */
    const bootstrapOnce = async (): Promise<void> => {
      const queues = await client.getWatchedQueues();
      if (stopped) return;
      startPoll(queues.map((q) => q.id)); // queue KPIs + heartbeats go live now
      void loadRosterAndSubscribe(queues); // agents + live state load in the background
    };

    // Bounded retry with capped exponential backoff (2s, 4s, 8s, 16s; max 30s). Never throws.
    const bootstrap = async (): Promise<void> => {
      for (let attempt = 1; attempt <= BOOTSTRAP_MAX_ATTEMPTS; attempt++) {
        if (stopped) return;
        try {
          await bootstrapOnce();
          return;
        } catch (e) {
          if (stopped) return;
          if (isAuthError(e)) {
            console.warn("GencloudFeed: bootstrap failed with 401 (check GENESYS_TOKEN); not retrying");
            return;
          }
          console.warn(`GencloudFeed: bootstrap attempt ${attempt}/${BOOTSTRAP_MAX_ATTEMPTS} failed:`, errMsg(e));
          if (attempt === BOOTSTRAP_MAX_ATTEMPTS) break;
          await sleep(Math.min(BOOTSTRAP_BASE_DELAY_MS * 2 ** (attempt - 1), BOOTSTRAP_MAX_DELAY_MS));
        }
      }
      if (!stopped) console.warn("GencloudFeed: bootstrap gave up after retries; feed is silent");
    };

    void bootstrap();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      wsTeardown?.();
      wsTeardown = null;
    };
  }
}
