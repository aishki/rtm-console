import type { AgentState } from "@/lib/types";
import type { FeedHandlers, FeedSource } from "./FeedSource";
import { GencloudClient, type QueueMember, type UserState } from "./gencloud/client";
import { consoleState, elapsedAtConnect, stateSince } from "./gencloud/state";
import { CallTracker } from "./gencloud/conversations";
import { WsManager } from "./gencloud/ws";
import { buildRoster, aggregateQueue, activeMembers, unknownStateIds } from "./gencloud/mappers";
import { floorMidnight } from "@/lib/floorTime";

// Server-only: pulls in the Node `ws` module. Never import this from a client component.

export interface GencloudConfig {
  /** e.g. https://api.mypurecloud.com */
  apiBase?: string;
  token?: string;
  /** Read on every subscribe, so a resubscribe picks up a token replaced at runtime. Wins over `token`. */
  getToken?: () => string | undefined;
  viewConfigId?: string;
  clientId?: string;
  clientSecret?: string;
}

const DEFAULT_API_BASE = "https://api.mypurecloud.com";
const DEFAULT_VIEW_CONFIG_ID = "9c9f8fd2-acab-4282-9442-ddba152f9c18";
const POLL_MS = 5000;
// Handle time per agent is a large query (about 330 KB at midday) and moves slowly: once a minute.
const HANDLE_POLL_MS = 60_000;
const BOOTSTRAP_MAX_ATTEMPTS = 5;
const BOOTSTRAP_BASE_DELAY_MS = 2000;
const BOOTSTRAP_MAX_DELAY_MS = 30000;
// Queues in this view can have hundreds of members each; several workers keep requests queued
// so none waits on another's round trip. The client paces them (BULK_PER_SECOND in
// gencloud/client.ts), which is what keeps the roster load under Genesys's rate limit.
const MEMBER_CONCURRENCY = 8;

/**
 * Production adapter for Genesys Cloud (Gencloud).
 *
 * The queue poll (calls-in-queue, ASA, abandon + heartbeats) starts as soon as the watched
 * queue IDs are known, independently of the roster — so the KPI cards and "live" state do not
 * wait on loading members for every queue. The roster (agents) and the presence/routing
 * WebSocket load in the background; a slow or failed roster never stops the queue poll.
 *
 * Calls come from the watched queues' conversation topic (gencloud/conversations.ts): call
 * end and transfer (calls, AHT, Short call, Transfer rate), hold (Long hold) and after-call work
 * (the ACW state, Extended ACW). AHT is Genesys's handle time per agent since midnight (talk,
 * hold and ACW on the watched queues), polled once a minute. Adherence comes from NICE IEX,
 * not Genesys, and stays quiet. Service level is the interval figure since midnight (oServiceLevel in the
 * aggregates query); there is no real-time service-level observation. "Midnight" is the floor's,
 * US Eastern (lib/floorTime.ts). Deactivated accounts are left out of the roster.
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
    const token = this.config.getToken?.() ?? this.config.token ?? process.env.GENESYS_TOKEN;
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
    let handleTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let wsTeardown: (() => void) | null = null;

    const errMsg = (e: unknown): string => (e instanceof Error ? e.message : "unknown error");
    // A 401 means a bad/expired token: retrying cannot help, so it is terminal.
    const isAuthError = (e: unknown): boolean => errMsg(e).includes("401");
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => { retryTimer = setTimeout(resolve, ms); });

    const pollOnce = async (queueIds: string[]): Promise<void> => {
      try {
        // "Today" is the floor's day: since Eastern midnight, not the server's (lib/floorTime.ts).
        const now = new Date();
        const [obs, agg] = await Promise.all([
          client.getObservations(queueIds),
          client.getAggregates(queueIds, { start: floorMidnight(now).toISOString(), end: now.toISOString() }),
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

    /** Each agent's AHT for the day, from Genesys's handle time on the watched queues. */
    const startHandlePoll = (queueIds: string[], idToName: Record<string, string>): void => {
      const pollHandle = async (): Promise<void> => {
        try {
          const now = new Date();
          const handle = await client.getAgentHandle(queueIds, { start: floorMidnight(now).toISOString(), end: now.toISOString() });
          if (stopped) return;
          handlers.onAgentStats?.(handle.flatMap((h) => idToName[h.userId] ? [{ agent: idToName[h.userId], aht: h.handleSec / h.handled }] : []));
        } catch (e) {
          console.warn("GencloudFeed: handle time poll failed:", errMsg(e));
        }
      };
      handleTimer = setInterval(() => { void pollHandle(); }, HANDLE_POLL_MS);
      void pollHandle();
    };

    /**
     * Everyone's presence in bulk, then routing status for those not Offline: routing is
     * OFF_QUEUE for anyone logged out, so it is only read where it can change the state.
     */
    const readStates = async (userIds: string[]): Promise<UserState[]> => {
      const states = await client.getPresences(userIds);
      const loggedIn = states.filter((s) => s.presence !== undefined && s.presence.toUpperCase() !== "OFFLINE");
      const routing = new Map((await client.getRoutingStatuses(loggedIn.map((s) => s.id))).map((r) => [r.id, r]));
      return states.map((s) => ({ ...s, routing: routing.get(s.id)?.routing, routingSince: routing.get(s.id)?.routingSince }));
    };

    /** Fetch members for every queue with bounded concurrency; one bad queue is skipped. */
    const fetchAllMembers = async (queues: { id: string; name: string }[]): Promise<Record<string, QueueMember[]>> => {
      const membersByQueue: Record<string, QueueMember[]> = {};
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
        const allMembers = await fetchAllMembers(queues);
        if (stopped) return;
        // Deactivated accounts stay queue members; leave them out so they do not sit on the floor as Offline.
        const unknown = unknownStateIds(allMembers);
        let active: Set<string> | null = new Set();
        if (unknown.length > 0) {
          try {
            active = new Set(await client.getActiveUserIds(unknown));
          } catch (e) {
            if (isAuthError(e)) throw e;
            active = null;
            console.warn("GencloudFeed: could not check account states; keeping every queue member:", errMsg(e));
          }
          if (stopped) return;
        }
        const membersByQueue = activeMembers(allMembers, active);
        const dropped = new Set(Object.values(allMembers).flat().map((m) => m.id)).size
          - new Set(Object.values(membersByQueue).flat().map((m) => m.id)).size;
        if (dropped > 0) console.info(`GencloudFeed: left ${dropped} deactivated accounts out of the roster`);
        const { org, agents, idToName } = buildRoster(queues, membersByQueue);
        handlers.onRoster({ org, agents });
        if (Object.keys(idToName).length === 0) {
          console.warn("GencloudFeed: roster is empty (no queue members loaded)");
          return;
        }
        startHandlePoll(queues.map((q) => q.id), idToName);
        const latest: Record<string, { presence?: string; routing?: string }> = {};
        const calls = new CallTracker();
        const stateOf = (userId: string) => consoleState(latest[userId]?.presence, latest[userId]?.routing, calls.summary(userId));
        /** From the calls alone, for an agent whose presence and routing have not arrived yet (around startup). */
        const callStateOf = (userId: string): AgentState | null => {
          if (latest[userId]) return stateOf(userId);
          const c = calls.summary(userId);
          return c.onCall ? "oncall" : c.acwSince !== null ? "acw" : null;
        };
        const secondsSince = (t: number) => Math.max(0, (Date.now() - t) / 1000);
        const teardown = await ws.subscribe(
          Object.keys(idToName),
          (ev) => {
            const name = idToName[ev.userId];
            if (!name) return;
            const cur = (latest[ev.userId] ??= {});
            if (ev.systemPresence !== undefined) cur.presence = ev.systemPresence;
            if (ev.routingStatus !== undefined) cur.routing = ev.routingStatus;
            handlers.onAgentState({ agent: name, state: stateOf(ev.userId) });
          },
          handlers.onHeartbeat,
          {
            // Call end, transfer, hold and after-call work, from every call on the watched queues.
            queueIds: queues.map((q) => q.id),
            onEvent: (body) => {
              for (const c of calls.update(body)) {
                const name = idToName[c.userId];
                if (!name) continue;
                const state = callStateOf(c.userId);
                if (!state) continue; // the state snapshot fills this agent in
                // A call first seen in ACW or on hold may have been there since before the console
                // connected: carry the real time over, and raise nothing for limits already passed.
                const acwAtConnect = c.first && state === "acw" && c.acwSince !== null;
                const holdAtConnect = c.first && c.hold?.on === true;
                handlers.onAgentState({
                  agent: name, state,
                  ...(c.ended && { callEnded: { transferred: c.ended.transferred, durationSec: c.ended.durationSec } }),
                  ...(c.hold && { onHold: c.hold.on, holdElapsed: c.hold.since !== undefined ? secondsSince(c.hold.since) : undefined }),
                  ...(acwAtConnect && { elapsed: secondsSince(c.acwSince!) }),
                  ...((acwAtConnect || holdAtConnect) && { seed: true }),
                });
              }
            },
          },
        );
        if (stopped) { teardown(); return; }
        wsTeardown = teardown;
        // Seed everyone's current state. Subscribed first, so a change that lands meanwhile
        // wins: the snapshot only fills the half (presence or routing) not reported yet.
        // An agent with no live change yet also gets the time already spent in that state,
        // from Genesys's own timestamps, so a restart does not set their timer back to 0.
        try {
          for (const s of await readStates(Object.keys(idToName))) {
            if (stopped) return;
            const name = idToName[s.id];
            if (!name) continue;
            const changedLive = latest[s.id] !== undefined;
            const cur = (latest[s.id] ??= {});
            cur.presence ??= s.presence;
            cur.routing ??= s.routing;
            const state = stateOf(s.id);
            const acwSince = calls.summary(s.id).acwSince;
            const since = changedLive ? undefined
              : state === "acw" && acwSince !== null ? acwSince
              : stateSince(s.presence, s.routing, s.presenceSince, s.routingSince);
            handlers.onAgentState(since === undefined
              ? { agent: name, state }
              : { agent: name, state, elapsed: elapsedAtConnect(state, since, Date.now(), floorMidnight(new Date()).getTime()), seed: true });
          }
        } catch (e) {
          console.warn("GencloudFeed: initial state snapshot failed; states fill in as agents change:", errMsg(e));
        }
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
      if (handleTimer) clearInterval(handleTimer);
      handleTimer = null;
      wsTeardown?.();
      wsTeardown = null;
    };
  }
}
