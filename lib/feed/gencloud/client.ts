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
}

export interface GencloudClientConfig {
  apiBase: string;
  token: string;
  viewConfigId: string;
}

const MAX_MEMBER_PAGES = 50;

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
    return {
      queueId: r.group?.queueId,
      offered: num(find("nOffered")?.count),
      answered: num(find("tAnswered")?.count),
      abandoned: num(find("tAbandon")?.count),
      // ASA ruling: ASA = average answer time (tAnswered.avg), ms -> s.
      asaSec: ms2s(find("tAnswered")?.avg),
      avgHandleSec: ms2s(find("tHandle")?.avg),
    };
  });
}

export class GencloudClient {
  constructor(
    private readonly cfg: GencloudClientConfig,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async request(method: "GET" | "POST", path: string, body?: unknown): Promise<Json> {
    const res = await this.fetchFn(`${this.cfg.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.cfg.token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) throw new Error("HTTP 401");
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
        const r = await this.request("GET", `/api/v2/routing/queues/divisionviews?pageSize=100&${q}`);
        for (const e of (r?.entities ?? []) as Json[]) names.set(e.id, e.name);
      } catch (e) {
        if (e instanceof Error && /401/.test(e.message)) throw e;
        // name resolution is best-effort; fall back to id
      }
    }
    return ids.map((id) => ({ id, name: names.get(id) ?? id }));
  }

  async getQueueMembers(queueId: string): Promise<{ id: string; name: string }[]> {
    const out: { id: string; name: string }[] = [];
    for (let page = 1; page <= MAX_MEMBER_PAGES; page++) {
      const r = await this.request(
        "GET",
        `/api/v2/routing/queues/${encodeURIComponent(queueId)}/members?pageSize=100&pageNumber=${page}`,
      );
      const ents: Json[] = r?.entities ?? [];
      for (const m of ents) {
        const id = m.id ?? m.user?.id;
        if (!id) continue;
        out.push({ id, name: m.name ?? m.user?.name ?? id });
      }
      if (ents.length < 100 || (r.pageCount && page >= r.pageCount)) break;
    }
    return out;
  }

  async getObservations(queueIds: string[]): Promise<QueueObs[]> {
    const resp = await this.request("POST", "/api/v2/analytics/queues/observations/query", {
      filter: { type: "or", predicates: queueIds.map((id) => ({ dimension: "queueId", value: id })) },
      // NOTE: there is no service-level observation metric — the API rejects oServiceLevel here
      // (valid: oWaiting/oInteracting/oOnQueueUsers/oUserRoutingStatuses/etc). Including it 400s the
      // whole query. Real-time service level would have to come from an interval aggregate instead;
      // serviceLevelPct therefore stays null until that is added.
      metrics: ["oWaiting", "oInteracting", "oOnQueueUsers", "oUserRoutingStatuses"],
    });
    return parseObservations(resp);
  }

  async getAggregates(queueIds: string[], interval: { start: string; end: string }): Promise<QueueAgg[]> {
    const resp = await this.request("POST", "/api/v2/analytics/conversations/aggregates/query", {
      interval: `${interval.start}/${interval.end}`,
      groupBy: ["queueId"],
      filter: { type: "or", predicates: queueIds.map((id) => ({ dimension: "queueId", value: id })) },
      metrics: ["nOffered", "tAnswered", "tAbandon", "tHandle"],
    });
    return parseAggregates(resp);
  }
}
