import { describe, expect, it } from "vitest";
import { CACHE_MS, type ManagerCache, cgsManagerLookup } from "./cgsManagers";

// Invented records. A real one also holds personal details, which must never be read.
const RECORD = { domainId: "AA00001", firstName: "Sample", personalEmail: "sample@example.com", managerDomainId: "bb00002 " };

function memCache(): ManagerCache & { data: Map<string, { manager: string | null; at: number }> } {
  const data = new Map<string, { manager: string | null; at: number }>();
  return { data, get: d => data.get(d), set: (d, manager, at) => { data.set(d, { manager, at }); } };
}

function fake(...responses: (Response | Error)[]) {
  const calls: { url: string; key: string | null }[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, key: new Headers(init?.headers).get("x-api-key") });
    const r = responses.shift();
    if (!r || r instanceof Error) throw r ?? new Error("no response");
    return r;
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const opts = { baseUrl: "https://directory.example/", apiKey: "test-key-0123456789", spacingMs: 0, rateLimitPauseMs: 0 };

describe("cgsManagerLookup", () => {
  it("reads only the manager's Domain ID, upper-cased, sending the key and an upper-case Domain ID", async () => {
    const { fetchFn, calls } = fake(json(RECORD));
    const cache = memCache();
    expect(await cgsManagerLookup({ ...opts, fetchFn, cache })(" aa00001")).toBe("BB00002");
    expect(calls).toEqual([{ url: "https://directory.example/api/associate?domainId=AA00001", key: "test-key-0123456789" }]);
    expect([...cache.data.values()].map(v => v.manager)).toEqual(["BB00002"]);
  });

  it("answers null for no record or no manager, and keeps that answer", async () => {
    const { fetchFn } = fake(new Response(null, { status: 404 }), json(null), json({ domainId: "CC00003" }));
    const cache = memCache();
    const look = cgsManagerLookup({ ...opts, fetchFn, cache });
    expect(await look("AA00001")).toBeNull();
    expect(await look("BB00002")).toBeNull(); // 200 with a null body: no such associate
    expect(await look("CC00003")).toBeNull();
    expect([...cache.data.keys()]).toEqual(["AA00001", "BB00002", "CC00003"]);
  });

  it("uses a saved answer until it is a week old", async () => {
    const { fetchFn, calls } = fake(json(RECORD));
    const cache = memCache();
    let now = 1_000_000;
    cache.set("AA00001", "ZZ00009", now);
    const look = cgsManagerLookup({ ...opts, fetchFn, cache, now: () => now });
    expect(await look("AA00001")).toBe("ZZ00009");
    expect(calls).toHaveLength(0);
    now += CACHE_MS;
    expect(await look("AA00001")).toBe("BB00002");
  });

  it("waits and tries again after a 429, and gives up quietly on an outage", async () => {
    const { fetchFn } = fake(new Response(null, { status: 429 }), json(RECORD), new Response(null, { status: 503 }), new Error("timeout"));
    const look = cgsManagerLookup({ ...opts, fetchFn });
    expect(await look("AA00001")).toBe("BB00002");
    expect(await look("AA00002")).toBeUndefined();
    expect(await look("AA00003")).toBeUndefined();
  });

  it("stops asking once the key is rejected, and says so without the key", async () => {
    const warnings: string[] = [];
    const { fetchFn, calls } = fake(new Response(null, { status: 401 }), json(RECORD));
    const look = cgsManagerLookup({ ...opts, fetchFn, warn: m => warnings.push(m) });
    expect(await look("AA00001")).toBeUndefined();
    expect(await look("AA00002")).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain("test-key");
  });
});
