/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export interface QueueObs {
  queueId: string;
  waiting: number;
  interacting: number;
  onQueueUsers: number;
  offQueueUsers: number;
  serviceLevelPct: number | null;
}

export interface QueueAgg {
  queueId: string;
  offered: number;
  answered: number;
  abandoned: number;
  asaSec: number | null;
  avgHandleSec: number | null;
  /** Total answer time, seconds: lets the floor ASA be weighted by calls answered. */
  answerSec: number;
  /** oServiceLevel: calls answered within the queue's target, out of the calls it counts. */
  slWithin: number;
  slCounted: number;
}

export interface QueueMember {
  id: string;
  name: string;
  state?: string;
}

/** A user's presence and routing status, each with the ISO time it took effect. */
export interface UserState {
  id: string;
  presence?: string;
  presenceSince?: string;
  routing?: string;
  routingSince?: string;
}

/** An agent's handled calls on the watched queues and their total handle time (talk, hold and ACW). */
export interface AgentHandle {
  userId: string;
  handled: number;
  handleSec: number;
}

export interface GencloudClientConfig {
  apiBase: string;
  token: string;
  viewConfigId: string;
}

const MAX_MEMBER_PAGES = 50;
const MAX_RATE_LIMIT_RETRIES = 4;

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function parseObservations(resp: Json): QueueObs[] {
  const results: Json[] = resp?.results ?? [];
  return results.map((r) => {
    let waiting = 0, interacting = 0, onQueueUsers = 0, offQueueUsers = 0;
    let sl: number | null = null;
    for (const d of (r.data ?? []) as Json[]) {
      const count = num(d?.stats?.count);
      switch (d?.metric) {
        case "oWaiting": waiting += count; break;
        case "oInteracting": interacting += count; break;
        case "oOnQueueUsers": onQueueUsers += count; break;
        case "oUserRoutingStatuses":
          if (d.qualifier === "OFF_QUEUE") offQueueUsers += count;
          break;
        case "oServiceLevel":
          if (typeof d?.stats?.ratio === "number" && Number.isFinite(d.stats.ratio)) sl = d.stats.ratio * 100;
          break;
      }
    }
    return { queueId: r.group?.queueId, waiting, interacting, onQueueUsers, offQueueUsers, serviceLevelPct: sl };
  });
}

export function parseAggregates(resp: Json): QueueAgg[] {
  const results: Json[] = resp?.results ?? [];
  return results.map((r) => {
    const metrics: Json[] = r.data?.[0]?.metrics ?? [];
    const find = (m: string) => metrics.find((x) => x?.metric === m)?.stats;
    const ms2s = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v / 1000 : null);
    // Genesys sends duration metrics as sum and count; `avg` is often absent, so derive it.
    const mean = (s: Json) => ms2s(s?.avg) ?? (num(s?.count) > 0 ? ms2s(num(s?.sum) / num(s?.count)) : null);
    const sl = find("oServiceLevel");
    return {
      queueId: r.group?.queueId,
      offered: num(find("nOffered")?.count),
      answered: num(find("tAnswered")?.count),
      abandoned: num(find("tAbandon")?.count),
      // ASA ruling: ASA = average answer time (tAnswered), ms -> s.
      asaSec: mean(find("tAnswered")),
      avgHandleSec: mean(find("tHandle")),
      answerSec: num(find("tAnswered")?.sum) / 1000,
      slWithin: num(sl?.numerator),
      slCounted: num(sl?.denominator),
    };
  });
}

/** tHandle per agent: the count is calls handled, the sum their handle time. Agents with none are left out. */
export function parseAgentHandle(resp: Json): AgentHandle[] {
  const out: AgentHandle[] = [];
  for (const r of (resp?.results ?? []) as Json[]) {
    const userId = r.group?.userId;
    const stats = ((r.data?.[0]?.metrics ?? []) as Json[]).find((x) => x?.metric === "tHandle")?.stats;
    const handled = num(stats?.count);
    if (userId && handled > 0) out.push({ userId, handled, handleSec: num(stats?.sum) / 1000 });
  }
  return out;
}

/**
 * Bulk requests (queue names, members, the state snapshot) per second. Genesys rate-limits per
 * token, and an unpaced roster load (90 queues, 8 at a time) drew 84 429s in 90 s, with
 * Retry-After up to 43 s, which also starved the 5-second queue poll and tripped the
 * "Gencloud not responding" rule at every start. Four a second loads the 580 member pages of the
 * watched view in about 2.5 minutes with no 429s; after any 429 (the supervisor whose token
 * this is shares the budget) bulk requests drop to one a second for a minute, so the poll gets
 * through.
 */
const BULK_PER_SECOND = 4;
const BULK_PER_SECOND_LIMITED = 1;
const LIMITED_FOR_MS = 60_000;

export class GencloudClient {
  private nextBulkAt = 0;
  private limitedUntil = 0;

  constructor(
    private readonly cfg: GencloudClientConfig,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
    private readonly bulkPerSecond = BULK_PER_SECOND,
  ) {}

  /** A one-off GET, spaced to `bulkPerSecond` across all callers. The queue poll is not paced. */
  private async bulk(path: string): Promise<Json> {
    const now = Date.now(), at = Math.max(now, this.nextBulkAt);
    const rate = now < this.limitedUntil ? Math.min(this.bulkPerSecond, BULK_PER_SECOND_LIMITED) : this.bulkPerSecond;
    this.nextBulkAt = at + 1000 / rate;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
    return this.request("GET", path);
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown, attempt = 0): Promise<Json> {
    const res = await this.fetchFn(`${this.cfg.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.cfg.token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) throw new Error("HTTP 401");
    // Rate limited: wait (honouring Retry-After) and retry, bounded. Genesys returns 429 under
    // bursty load such as fetching members for many large queues at once.
    // Any 429, poll or bulk, means the token's budget is tight: slow the bulk requests down.
    if (res.status === 429) this.limitedUntil = Date.now() + LIMITED_FOR_MS;
    if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 15000)
        : Math.min(1000 * 2 ** attempt, 8000);
      await new Promise((r) => setTimeout(r, waitMs));
      return this.request(method, path, body, attempt + 1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async getWatchedQueues(): Promise<{ id: string; name: string }[]> {
    const vc = await this.request(
      "GET",
      `/api/v2/analytics/reporting/settings/viewconfigurations/${encodeURIComponent(this.cfg.viewConfigId)}`,
    );
    const ids: string[] = vc?.filter?.queueIds ?? [];
    const names = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      try {
        const q = batch.map((id) => `id=${encodeURIComponent(id)}`).join("&");
        const r = await this.bulk(`/api/v2/routing/queues/divisionviews?pageSize=100&${q}`);
        for (const e of (r?.entities ?? []) as Json[]) names.set(e.id, e.name);
      } catch (e) {
        if (e instanceof Error && /401/.test(e.message)) throw e;
        // name resolution is best-effort; fall back to id
      }
    }
    return ids.map((id) => ({ id, name: names.get(id) ?? id }));
  }

  /**
   * A queue's members. `state` is the user's account state ("active", "inactive", "deleted").
   * Genesys leaves it out, sending a stub user, for deactivated accounts that are still
   * members: 1,038 of the watched view's 2,743. See `activeMembers` in mappers.ts.
   */
  async getQueueMembers(queueId: string): Promise<QueueMember[]> {
    const out: QueueMember[] = [];
    for (let page = 1; page <= MAX_MEMBER_PAGES; page++) {
      const r = await this.bulk(`/api/v2/routing/queues/${encodeURIComponent(queueId)}/members?pageSize=100&pageNumber=${page}`);
      const ents: Json[] = r?.entities ?? [];
      for (const m of ents) {
        const id = m.id ?? m.user?.id;
        if (!id) continue;
        out.push({ id, name: m.name ?? m.user?.name ?? id, state: m.user?.state });
      }
      if (ents.length < 100 || (r.pageCount && page >= r.pageCount)) break;
    }
    return out;
  }

  /** The users among `userIds` whose accounts are active: the users lookup returns no others. */
  async getActiveUserIds(userIds: string[]): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < userIds.length; i += 100) {
      const q = userIds.slice(i, i + 100).map((id) => `id=${encodeURIComponent(id)}`).join("&");
      const r = await this.bulk(`/api/v2/users?pageSize=100&${q}`);
      for (const u of (r?.entities ?? []) as Json[]) if (u?.id) out.push(u.id);
    }
    return out;
  }

  /**
   * Current Genesys presence of these users, 50 a request. About 190 bytes an agent, a tenth of
   * the users lookup with presence and routing expanded.
   */
  async getPresences(userIds: string[]): Promise<UserState[]> {
    const out: UserState[] = [];
    for (let i = 0; i < userIds.length; i += 50) {
      const ids = userIds.slice(i, i + 50).map(encodeURIComponent).join(",");
      const r = await this.bulk(`/api/v2/users/presences/purecloud/bulk?id=${ids}`);
      for (const p of (Array.isArray(r) ? r : []) as Json[]) {
        const id = p?.userId ?? p?.id;
        if (id) out.push({ id, presence: p.presenceDefinition?.systemPresence, presenceSince: p.modifiedDate });
      }
    }
    return out;
  }

  /** Current routing status of these users, 100 a request. Genesys has no bulk routing-status read. */
  async getRoutingStatuses(userIds: string[]): Promise<UserState[]> {
    const out: UserState[] = [];
    for (let i = 0; i < userIds.length; i += 100) {
      const q = userIds.slice(i, i + 100).map((id) => `id=${encodeURIComponent(id)}`).join("&");
      const r = await this.bulk(`/api/v2/users?pageSize=100&expand=routingStatus&${q}`);
      for (const u of (r?.entities ?? []) as Json[]) {
        if (u?.id) out.push({ id: u.id, routing: u.routingStatus?.status, routingSince: u.routingStatus?.startTime });
      }
    }
    return out;
  }

  async getObservations(queueIds: string[]): Promise<QueueObs[]> {
    const resp = await this.request("POST", "/api/v2/analytics/queues/observations/query", {
      filter: { type: "or", predicates: queueIds.map((id) => ({ dimension: "queueId", value: id })) },
      // NOTE: there is no service-level observation metric — the API rejects oServiceLevel here
      // (valid: oWaiting/oInteracting/oOnQueueUsers/oUserRoutingStatuses/etc). Including it 400s the
      // whole query. Service level comes from the interval aggregate instead (getAggregates), so
      // serviceLevelPct here stays null.
      metrics: ["oWaiting", "oInteracting", "oOnQueueUsers", "oUserRoutingStatuses"],
    });
    return parseObservations(resp);
  }

  async getAggregates(queueIds: string[], interval: { start: string; end: string }): Promise<QueueAgg[]> {
    const resp = await this.request("POST", "/api/v2/analytics/conversations/aggregates/query", {
      interval: `${interval.start}/${interval.end}`,
      groupBy: ["queueId"],
      filter: { type: "or", predicates: queueIds.map((id) => ({ dimension: "queueId", value: id })) },
      // oServiceLevel is valid here (unlike in the observation query): it is the interval SL.
      metrics: ["nOffered", "tAnswered", "tAbandon", "tHandle", "oServiceLevel"],
    });
    return parseAggregates(resp);
  }

  /**
   * Handle time per agent on these queues (talk, hold and after-call work). About 330 KB for the
   * watched view at midday, so it is polled once a minute, not with the queue numbers.
   */
  async getAgentHandle(queueIds: string[], interval: { start: string; end: string }): Promise<AgentHandle[]> {
    const resp = await this.request("POST", "/api/v2/analytics/conversations/aggregates/query", {
      interval: `${interval.start}/${interval.end}`,
      groupBy: ["userId"],
      filter: { type: "or", predicates: queueIds.map((id) => ({ dimension: "queueId", value: id })) },
      metrics: ["tHandle"],
    });
    return parseAgentHandle(resp);
  }
}
