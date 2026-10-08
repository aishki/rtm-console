import WebSocket from "ws";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface NotificationEvent {
  userId: string;
  systemPresence?: string;
  routingStatus?: string;
}

/** Genesys limit: 1000 topics per notification channel. */
export const MAX_TOPICS_PER_CHANNEL = 1000;

/** Chunk topics (presence + routingStatus per user) so no channel exceeds the budget.
 *  A user's two topics are kept together in the same chunk. */
export function splitTopics(userIds: string[], maxTopicsPerChannel: number): string[][] {
  const usersPerChunk = Math.max(1, Math.floor(maxTopicsPerChannel / 2));
  const chunks: string[][] = [];
  for (let i = 0; i < userIds.length; i += usersPerChunk) {
    const topics: string[] = [];
    for (const id of userIds.slice(i, i + usersPerChunk)) {
      topics.push(`v2.users.${id}.presence`, `v2.users.${id}.routingStatus`);
    }
    chunks.push(topics);
  }
  return chunks;
}

/** The queue conversation topic for each queue, in channels of at most `maxTopicsPerChannel`. */
export function conversationTopics(queueIds: string[], maxTopicsPerChannel: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < queueIds.length; i += maxTopicsPerChannel) {
    chunks.push(queueIds.slice(i, i + maxTopicsPerChannel).map((id) => `v2.routing.queues.${id}.conversations`));
  }
  return chunks;
}

/** The event body of a queue conversation notification, or null for any other message. */
export function parseConversation(raw: string): any | null {
  let msg: any;
  try { msg = JSON.parse(raw); } catch { return null; }
  return typeof msg?.topicName === "string" && /^v2\.routing\.queues\.[^.]+\.conversations$/.test(msg.topicName) ? msg.eventBody ?? null : null;
}

/** Returns null for heartbeats (channel.metadata) and anything unrecognised. */
export function parseNotification(raw: string): NotificationEvent | null {
  let msg: any;
  try { msg = JSON.parse(raw); } catch { return null; }
  const topic: unknown = msg?.topicName;
  if (typeof topic !== "string" || topic === "channel.metadata") return null;
  const m = /^v2\.users\.([^.]+)\.(presence|routingStatus)$/.exec(topic);
  if (!m) return null;
  const [, userId, kind] = m;
  const body = msg.eventBody ?? {};
  if (kind === "presence") {
    return { userId, systemPresence: body.presenceDefinition?.systemPresence };
  }
  return { userId, routingStatus: body.routingStatus?.status };
}

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;

export class WsManager {
  constructor(
    private readonly apiBase: string,
    private readonly token: string,
  ) {}

  private async api(method: "POST" | "PUT", path: string, body: unknown): Promise<any> {
    const res = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /**
   * Presence and routing for `userIds`, and, with `conversations`, every call on those queues
   * (one more channel per 1,000 queues).
   */
  async subscribe(
    userIds: string[],
    onEvent: (e: NotificationEvent) => void,
    onHeartbeat: () => void,
    conversations?: { queueIds: string[]; onEvent: (body: any) => void },
  ): Promise<() => void> {
    let closed = false;
    const sockets = new Set<WebSocket>();
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const runChannel = (topics: string[]): void => {
      let attempt = 0;
      const connect = async (): Promise<void> => {
        if (closed) return;
        try {
          // Fresh channel each (re)connect: covers channel expiry as well as socket drops.
          const ch = await this.api("POST", "/api/v2/notifications/channels", {});
          if (closed) return;
          const ws = new WebSocket(ch.connectUri); // connectUri carries a secret: never log
          sockets.add(ws);
          ws.on("message", (data) => {
            const raw = data.toString();
            const ev = parseNotification(raw);
            const conv = ev || !conversations ? null : parseConversation(raw);
            if (ev) onEvent(ev);
            else if (conv) conversations?.onEvent(conv);
            else {
              // null covers heartbeats and unrecognised topics; only real heartbeats count
              try { if (JSON.parse(raw)?.topicName === "channel.metadata") onHeartbeat(); } catch { /* ignore */ }
            }
          });
          ws.on("open", () => {
            this.api("PUT", `/api/v2/notifications/channels/${encodeURIComponent(ch.id)}/subscriptions`,
              topics.map((id) => ({ id }))).then(() => { attempt = 0; }, () => ws.close());
          });
          ws.on("error", () => { /* close follows; handled there */ });
          ws.on("close", () => {
            sockets.delete(ws);
            scheduleReconnect();
          });
        } catch {
          scheduleReconnect();
        }
      };
      const scheduleReconnect = (): void => {
        if (closed) return;
        const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt++);
        const t = setTimeout(() => { timers.delete(t); void connect(); }, delay);
        timers.add(t);
      };
      void connect();
    };

    for (const topics of splitTopics(userIds, MAX_TOPICS_PER_CHANNEL)) runChannel(topics);
    if (conversations) for (const topics of conversationTopics(conversations.queueIds, MAX_TOPICS_PER_CHANNEL)) runChannel(topics);

    return () => {
      closed = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const ws of sockets) { try { ws.close(); } catch { /* ignore */ } }
      sockets.clear();
    };
  }
}
