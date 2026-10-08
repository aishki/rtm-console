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
