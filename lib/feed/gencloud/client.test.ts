import { describe, it, expect } from "vitest";
import { GencloudClient, parseObservations, parseAggregates, parseAgentHandle } from "./client";

describe("parseObservations", () => {
  it("maps observation metrics and service level ratio", () => {
    const [o] = parseObservations({ results: [{ group:{ queueId:"q1" }, data:[
      { metric:"oWaiting", stats:{ count:3 } },
      { metric:"oInteracting", stats:{ count:2 } },
      { metric:"oUserRoutingStatuses", qualifier:"OFF_QUEUE", stats:{ count:5 } },
      { metric:"oServiceLevel", stats:{ ratio:0.9 } } ]}] });
    expect(o).toMatchObject({ queueId:"q1", waiting:3, interacting:2, offQueueUsers:5 });
    expect(o.serviceLevelPct).toBeCloseTo(90);
  });
  it("returns [] for empty results (no crash)", () => {
    expect(parseObservations({ results: [] })).toEqual([]);
    expect(parseObservations({})).toEqual([]);
  });
});

describe("parseAggregates", () => {
  it("maps aggregate metrics, converting ms to seconds", () => {
    const [a] = parseAggregates({ results: [{ group:{ queueId:"q1" }, data:[{ metrics:[
      { metric:"nOffered", stats:{ count:10 } },
      { metric:"tAbandon", stats:{ count:1 } },
      { metric:"tAnswered", stats:{ count:9, avg:20000 } },
      { metric:"tHandle", stats:{ avg:300000 } } ]}] }] });
    expect(a).toMatchObject({ queueId:"q1", offered:10, abandoned:1, answered:9 });
    expect(a.asaSec).toBeCloseTo(20);      // tAnswered.avg 20000ms -> 20s (ASA ruling)
    expect(a.avgHandleSec).toBeCloseTo(300);
  });
  it("derives averages from sum and count, and reads the interval service level", () => {
    const [a] = parseAggregates({ results: [{ group:{ queueId:"q1" }, data:[{ metrics:[
      { metric:"tAnswered", stats:{ count:4, sum:80000 } },
      { metric:"tHandle", stats:{ count:4, sum:1200000 } },
      { metric:"oServiceLevel", stats:{ ratio:0.75, numerator:3, denominator:4, target:0.8 } } ]}] }] });
    expect(a.asaSec).toBeCloseTo(20);
    expect(a.avgHandleSec).toBeCloseTo(300);
    expect(a.answerSec).toBeCloseTo(80);
    expect(a).toMatchObject({ slWithin:3, slCounted:4 });
  });
  it("tolerates missing metrics", () => {
    const [a] = parseAggregates({ results: [{ group:{ queueId:"q1" }, data:[{ metrics:[] }] }] });
    expect(a).toMatchObject({ queueId:"q1", offered:0, abandoned:0 });
    expect(a.asaSec).toBeNull();
  });
});

describe("parseAgentHandle", () => {
  it("reads calls handled and handle time per agent, leaving out agents with none", () => {
    expect(parseAgentHandle({ results: [
      { group: { userId: "u1" }, data: [{ metrics: [{ metric: "tHandle", stats: { count: 4, sum: 2_000_000 } }] }] },
      { group: { userId: "u2" }, data: [{ metrics: [{ metric: "tHandle", stats: { count: 0, sum: 0 } }] }] },
      { group: { userId: "u3" }, data: [{ metrics: [] }] },
    ] })).toEqual([{ userId: "u1", handled: 4, handleSec: 2000 }]);
    expect(parseAgentHandle({})).toEqual([]);
  });
});

describe("state reads", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("reads presence in bulk, 50 users a request", async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(url);
      const ids = new URL(url).searchParams.get("id")!.split(",");
      return ok(ids.map((id) => ({ userId: id, presenceDefinition: { systemPresence: "On Queue" }, modifiedDate: "2026-10-09T12:00:00Z" })));
    }) as unknown as typeof fetch;
    const client = new GencloudClient({ apiBase: "https://x", token: "t", viewConfigId: "v" }, fetchFn, 1000);
    const ids = Array.from({ length: 120 }, (_, i) => `u${i}`);
    const states = await client.getPresences(ids);
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain("/api/v2/users/presences/purecloud/bulk?id=");
    expect(states).toHaveLength(120);
    expect(states[0]).toEqual({ id: "u0", presence: "On Queue", presenceSince: "2026-10-09T12:00:00Z" });
  });

  it("reads routing status with its start time", async () => {
    const fetchFn = (async () => ok({ entities: [{ id: "u1", routingStatus: { status: "INTERACTING", startTime: "2026-10-09T12:01:00Z" } }] })) as unknown as typeof fetch;
    const client = new GencloudClient({ apiBase: "https://x", token: "t", viewConfigId: "v" }, fetchFn, 1000);
    expect(await client.getRoutingStatuses(["u1"])).toEqual([{ id: "u1", routing: "INTERACTING", routingSince: "2026-10-09T12:01:00Z" }]);
  });
});

describe("request pacing", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  it("spaces bulk requests to the configured rate, across concurrent callers", async () => {
    const at: number[] = [];
    const fetchFn = (async () => { at.push(Date.now()); return ok({ entities: [] }); }) as unknown as typeof fetch;
    const client = new GencloudClient({ apiBase: "https://x", token: "t", viewConfigId: "v" }, fetchFn, 20);
    // Three callers at once, as the member workers do: still one request per 50 ms.
    await Promise.all([client.getQueueMembers("a"), client.getQueueMembers("b"), client.getQueueMembers("c")]);
    expect(at).toHaveLength(3);
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(40);
  });

  it("does not pace the queue poll", async () => {
    const at: number[] = [];
    const fetchFn = (async () => { at.push(Date.now()); return ok({ results: [] }); }) as unknown as typeof fetch;
    const client = new GencloudClient({ apiBase: "https://x", token: "t", viewConfigId: "v" }, fetchFn, 1);
    await Promise.all([client.getObservations(["q"]), client.getAggregates(["q"], { start: "s", end: "e" })]);
    expect(at[1] - at[0]).toBeLessThan(200);
  });
});

describe("rate-limit backoff", () => {
  it("slows bulk requests to one a second after a 429", async () => {
    const at: number[] = [];
    let first = true;
    const fetchFn = (async () => {
      at.push(Date.now());
      if (first) { first = false; return new Response("{}", { status: 429, headers: { "retry-after": "0" } }); }
      return new Response(JSON.stringify({ entities: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new GencloudClient({ apiBase: "https://x", token: "t", viewConfigId: "v" }, fetchFn, 50);
    await client.getQueueMembers("a"); // 429, retried, then fine
    await client.getQueueMembers("b"); // paced at 20 ms before the 429; now about a second
    await client.getQueueMembers("c");
    expect(at.at(-1)! - at.at(-2)!).toBeGreaterThanOrEqual(900);
  });
});

describe("watched queues", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("finds the queue map's queues by name across every page, ignoring case", async () => {
    const urls: string[] = [];
    const pages: Record<string, unknown> = {
      "1": { pageCount: 2, entities: [{ id: "q1", name: "CSBD_A" }, { id: "q2", name: "Other" }] },
      "2": { pageCount: 2, entities: [{ id: "q3", name: "csbd_b " }] },
    };
    const fetchFn = (async (url: string) => {
      urls.push(url);
      return ok(pages[new URL(url).searchParams.get("pageNumber")!]);
    }) as unknown as typeof fetch;
    const client = new GencloudClient({ apiBase: "https://x", token: "t", viewConfigId: "v", queueNames: ["csbd_a", "CSBD_B", "Not in org"] }, fetchFn, 1000);
    expect(await client.getWatchedQueues()).toEqual([{ id: "q1", name: "CSBD_A" }, { id: "q3", name: "csbd_b " }]);
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => u.includes("/api/v2/routing/queues/divisionviews/all"))).toBe(true);
  });

  it("reads the saved view when there is no queue map", async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(url);
      return url.includes("viewconfigurations") ? ok({ filter: { queueIds: ["q1"] } }) : ok({ entities: [{ id: "q1", name: "Queue 1" }] });
    }) as unknown as typeof fetch;
    const client = new GencloudClient({ apiBase: "https://x", token: "t", viewConfigId: "v", queueNames: [] }, fetchFn, 1000);
    expect(await client.getWatchedQueues()).toEqual([{ id: "q1", name: "Queue 1" }]);
    expect(urls[0]).toContain("/viewconfigurations/v");
  });

  it("fails on another user's saved view", async () => {
    const fetchFn = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
    const client = new GencloudClient({ apiBase: "https://x", token: "t", viewConfigId: "v" }, fetchFn, 1000);
    await expect(client.getWatchedQueues()).rejects.toThrow("HTTP 404");
  });
});

describe("large queue lists", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const queueIdsIn = (init?: RequestInit): string[] => JSON.parse(String(init?.body)).filter.predicates.map((p: { value: string }) => p.value);
  const ids = Array.from({ length: 202 }, (_, i) => `q${i}`);

  it("splits analytics queries to stay under Genesys's 200 predicates", async () => {
    const sizes: number[] = [];
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      sizes.push(queueIdsIn(init).length);
      return ok({ results: queueIdsIn(init).map((id) => ({ group: { queueId: id }, data: [] })) });
    }) as unknown as typeof fetch;
    const client = new GencloudClient({ apiBase: "https://x", token: "t", viewConfigId: "v" }, fetchFn, 1000);
    expect(await client.getObservations(ids)).toHaveLength(202);
    expect(sizes).toEqual([100, 100, 2]);
  });

  it("adds an agent's handle time up across queries", async () => {
    const fetchFn = (async () => ok({ results: [{ group: { userId: "u1" }, data: [{ metrics: [{ metric: "tHandle", stats: { count: 2, sum: 60000 } }] }] }] })) as unknown as typeof fetch;
    const client = new GencloudClient({ apiBase: "https://x", token: "t", viewConfigId: "v" }, fetchFn, 1000);
    expect(await client.getAgentHandle(ids, { start: "s", end: "e" })).toEqual([{ userId: "u1", handled: 6, handleSec: 180 }]);
  });

  it("leaves out the divisions whose statistics the token may not read", async () => {
    const fetchFn = (async (_url: string, init?: RequestInit) =>
      queueIdsIn(init).includes("q2") ? new Response("{}", { status: 403 }) : ok({ results: [] })) as unknown as typeof fetch;
    const client = new GencloudClient({ apiBase: "https://x", token: "t", viewConfigId: "v" }, fetchFn, 1000);
    const a = { id: "a", name: "A" }, b = { id: "b", name: "B" };
    const { readable, forbidden } = await client.readableQueues([
      { id: "q1", name: "Q1", division: a }, { id: "q2", name: "Q2", division: b }, { id: "q3", name: "Q3", division: a },
    ]);
    expect(readable.map((q) => q.id)).toEqual(["q1", "q3"]);
    expect(forbidden.map((q) => q.id)).toEqual(["q2"]);
  });
});
