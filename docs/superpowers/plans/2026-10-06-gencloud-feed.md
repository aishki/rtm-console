# Gencloud Feed Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement rtm-console's `GencloudFeed` stub so the live floor is driven by real Genesys Cloud data, by porting the proven HTTP + WebSocket ingestion from the sibling `rtm-dashboard` project and mapping it onto the `FeedHandlers` contract.

**Architecture:** `GencloudFeed` is a push `FeedSource`: on `subscribe(handlers)` it authenticates with a bearer token, resolves the watched queues + their members into a roster (`onRoster`), opens the Genesys notifications WebSocket for presence/routingStatus (`onAgentState` + `onHeartbeat`), and polls queue observations/aggregates (`onQueue` + `onHeartbeat`). The rules engine, scoping, screens, and CSV replay already consume these events unchanged.

**Tech Stack:** TypeScript, Next 16 (App Router), Node (server-side feed inside the runtime singleton), `ws` for the WebSocket, Vitest.

**Spec / design:** Agreed in-session (direction A). Source of the proven ingestion code to port: the `rtm-dashboard` repo at `D:\Dev\ELV\rtm-dashboard\src\genesys\*` and `src\model\*` (tokenSource.ts, wsManager.ts, stateMapping.ts, kpis.ts) — each already unit-tested there.

## Global Constraints

- Agent-state enum is identical across repos: `"oncall"|"avail"|"acw"|"auxb"|"auxp"|"outb"|"off"` (rtm-console `lib/types.ts` `AgentState`). Map to these exact values.
- `FeedHandlers` keys agents by **name** (`AgentStateEvent.agent` is the display name), not id. The WS delivers user ids; the roster must provide an id→name map.
- Region host and token come from env — never hardcode `api.mypurecloud.com` at call sites. Env: `GENESYS_TOKEN`, `GENCLOUD_API_BASE` (region base, e.g. `https://api.mypurecloud.com`), `RTM_VIEW_CONFIG_ID` (default `9c9f8fd2-acab-4282-9442-ddba152f9c18`).
- The bearer token is NEVER logged, NEVER sent to the browser, NEVER written to a git-tracked file.
- On HTTP 401, throw an error whose message contains `"401"` so the feed goes silent and the engine's feed-stale rule fires (the correct "feed down" behavior).
- `onQueue` receives a SINGLE floor-level `Queue { cq, sl, asa, ab }` aggregated across all watched queues (not per-queue).
- v1 org model: **one team per watched queue** — `Team { team: <queue name>, tl: "", mgr: "", lob: <queue name> }`.
- Automated tests must pass with no token and no network (pure functions only; no live calls in the suite).
- Next 16 has breaking changes vs older Next — before writing any Next-specific code (routes/config), read the relevant guide under `node_modules/next/dist/docs/`. The feed code itself is plain TS and does not need this.
- The committed change must not include `.env.local` or any token.

## Review Focus

- **Expired/invalid token (401)** → a thrown `"401"` error stops feed activity so the engine marks the floor stale; no infinite tight error loop. (Task 1 + Task 5)
- **Empty/quiet queue interval** → aggregated `Queue` has finite numbers (0 where appropriate), never `NaN`. (Task 4)
- **Roster larger than one WS channel's topic budget** → `splitTopics` splits at 500 users/channel (2 topics each). (Task 3)
- **WS drop / 24h channel expiry** → reconnect with backoff, fresh channel on reconnect, re-subscribe; `onHeartbeat` resumes. (Task 3 + Task 5)
- **Agent on multiple watched queues** → appears once in the roster (deduped by id/name), assigned a deterministic single team. (Task 4)

---

## File Structure

```
lib/feed/gencloud/client.ts     # HTTP: token+region fetch, viewconfig, members, observations, aggregates, parsers
lib/feed/gencloud/state.ts      # mapGenesysState(presence, routing) -> AgentState
lib/feed/gencloud/ws.ts         # splitTopics, parseNotification, WsManager (notifications channel lifecycle)
lib/feed/gencloud/mappers.ts    # buildRoster(...) -> {org, agents}; aggregateQueue(obs, agg) -> Queue
lib/feed/GencloudFeed.ts        # (replace stub) orchestrates the above into FeedHandlers
lib/feed/gencloud/*.test.ts     # unit tests for the pure pieces
.env.example                    # add GENESYS_TOKEN / GENCLOUD_API_BASE / RTM_VIEW_CONFIG_ID
```

Porting note for every task: the equivalent logic exists and is tested in `rtm-dashboard`. Read the named source file there, port the logic, and adapt types to rtm-console's `lib/types.ts`. Do not import across repos — copy the code in.

---

## Task 1: Genesys HTTP client + response parsers

**Files:**
- Create: `lib/feed/gencloud/client.ts`
- Test: `lib/feed/gencloud/client.test.ts`
- Port from: `D:\Dev\ELV\rtm-dashboard\src\genesys\tokenSource.ts` (HTTP methods + `parseObservations`/`parseAggregates`)

**Interfaces:**
- Produces:
  - `interface GencloudClientConfig { apiBase: string; token: string; viewConfigId: string }`
  - `class GencloudClient` with `getWatchedQueues(): Promise<{id:string;name:string}[]>`, `getQueueMembers(queueId): Promise<{id:string;name:string}[]>`, `getObservations(queueIds: string[]): Promise<QueueObs[]>`, `getAggregates(queueIds: string[], interval:{start:string;end:string}): Promise<QueueAgg[]>`. Constructor takes config + optional injected `fetchFn` (default global `fetch`).
  - Exported pure `parseObservations(resp): QueueObs[]` and `parseAggregates(resp): QueueAgg[]`.
  - `interface QueueObs { queueId:string; waiting:number; interacting:number; onQueueUsers:number; offQueueUsers:number; serviceLevelPct:number|null }`
  - `interface QueueAgg { queueId:string; offered:number; answered:number; abandoned:number; asaSec:number|null; avgHandleSec:number|null }`

- [ ] **Step 1: Write the failing test**

```ts
// lib/feed/gencloud/client.test.ts
import { describe, it, expect } from "vitest";
import { parseObservations, parseAggregates } from "./client";

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
  it("tolerates missing metrics", () => {
    const [a] = parseAggregates({ results: [{ group:{ queueId:"q1" }, data:[{ metrics:[] }] }] });
    expect(a).toMatchObject({ queueId:"q1", offered:0, abandoned:0 });
    expect(a.asaSec).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/feed/gencloud/client.test.ts` → Expected: FAIL (module missing).

- [ ] **Step 3: Implement `client.ts`**

Port the parsers and HTTP methods from `rtm-dashboard/src/genesys/tokenSource.ts`. Adapt: config has `{apiBase, token, viewConfigId}`; all requests send `Authorization: Bearer <token>`; URLs built from `apiBase`; a 401 throws `new Error("HTTP 401")`. Keep `asaSec = tAnswered.avg / 1000` (the carried ASA ruling). `getWatchedQueues` reads `GET /api/v2/analytics/reporting/settings/viewconfigurations/{viewConfigId}` → `filter.queueIds`, resolving names (id as name fallback). `getQueueMembers` pages `GET /api/v2/routing/queues/{id}/members?pageSize=100` with a hard page cap of 50 (safety against a runaway loop). Observations `POST /api/v2/analytics/queues/observations/query` metrics `["oWaiting","oInteracting","oOnQueueUsers","oUserRoutingStatuses","oServiceLevel"]`; aggregates `POST /api/v2/analytics/conversations/aggregates/query` metrics `["nOffered","tAnswered","tAbandon","tHandle"]`, `groupBy:["queueId"]`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/feed/gencloud/client.test.ts` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/feed/gencloud/client.ts lib/feed/gencloud/client.test.ts
git commit -m "feat(gencloud): Genesys HTTP client and response parsers"
```

---

## Task 2: Agent state mapping

**Files:**
- Create: `lib/feed/gencloud/state.ts`
- Test: `lib/feed/gencloud/state.test.ts`
- Port from: `D:\Dev\ELV\rtm-dashboard\src\model\stateMapping.ts`

**Interfaces:**
- Produces: `mapGenesysState(presence: string | undefined, routing: string | undefined): AgentState` (import `AgentState` from `@/lib/types`).

- [ ] **Step 1: Write the failing test**

```ts
// lib/feed/gencloud/state.test.ts
import { describe, it, expect } from "vitest";
import { mapGenesysState } from "./state";

describe("mapGenesysState", () => {
  it("INTERACTING -> oncall", () => expect(mapGenesysState("AVAILABLE","INTERACTING")).toBe("oncall"));
  it("IDLE+AVAILABLE -> avail", () => expect(mapGenesysState("AVAILABLE","IDLE")).toBe("avail"));
  it("BREAK -> auxb", () => expect(mapGenesysState("BREAK","IDLE")).toBe("auxb"));
  it("BUSY -> auxp", () => expect(mapGenesysState("BUSY","IDLE")).toBe("auxp"));
  it("OFF_QUEUE -> off", () => expect(mapGenesysState("AVAILABLE","OFF_QUEUE")).toBe("off"));
  it("OFFLINE -> off", () => expect(mapGenesysState("OFFLINE", undefined)).toBe("off"));
  it("unknown presence -> auxp", () => expect(mapGenesysState("MEETING","IDLE")).toBe("auxp"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/feed/gencloud/state.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement `state.ts`**

Port `mapState` from `rtm-dashboard/src/model/stateMapping.ts` verbatim (rename to `mapGenesysState`, import `AgentState` from `@/lib/types`). Branch order: OFFLINE/OFF_QUEUE→off first, then INTERACTING→oncall, COMMUNICATING→acw, BREAK/MEAL→auxb, IDLE+AVAILABLE→avail, BUSY/AWAY/MEETING/TRAINING→auxp, default auxp.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/feed/gencloud/state.test.ts` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/feed/gencloud/state.ts lib/feed/gencloud/state.test.ts
git commit -m "feat(gencloud): presence/routingStatus -> AgentState mapping"
```

---

## Task 3: Notifications WebSocket manager

**Files:**
- Create: `lib/feed/gencloud/ws.ts`
- Test: `lib/feed/gencloud/ws.test.ts`
- Modify: `package.json` (add `ws` + `@types/ws`)
- Port from: `D:\Dev\ELV\rtm-dashboard\src\genesys\wsManager.ts`

**Interfaces:**
- Produces: `splitTopics(userIds: string[], maxTopicsPerChannel: number): string[][]`; `parseNotification(raw: string): { userId:string; systemPresence?:string; routingStatus?:string } | null`; `class WsManager` with `constructor(apiBase, token)` and `subscribe(userIds: string[], onEvent, onHeartbeat): Promise<() => void>`.

- [ ] **Step 1: Add the ws dependency**

```bash
npm install ws && npm install -D @types/ws
```

- [ ] **Step 2: Write the failing test**

```ts
// lib/feed/gencloud/ws.test.ts
import { describe, it, expect } from "vitest";
import { splitTopics, parseNotification } from "./ws";

describe("splitTopics", () => {
  it("splits at the topic budget (2 topics/user)", () => {
    const users = Array.from({length:600},(_,i)=>"u"+i);
    const chans = splitTopics(users, 1000);
    expect(chans.length).toBe(2);
    expect(chans[0].length).toBe(1000);
    expect(chans[1].length).toBe(200);
  });
});
describe("parseNotification", () => {
  it("null for heartbeat", () =>
    expect(parseNotification(JSON.stringify({ topicName:"channel.metadata", eventBody:{ message:"WebSocket Heartbeat" } }))).toBeNull());
  it("parses presence", () => {
    const e = parseNotification(JSON.stringify({ topicName:"v2.users.u1.presence",
      eventBody:{ presenceDefinition:{ systemPresence:"BUSY" }, modifiedDate:"2026-10-06T09:26:23Z" } }));
    expect(e).toMatchObject({ userId:"u1", systemPresence:"BUSY" });
  });
  it("parses routingStatus", () => {
    const e = parseNotification(JSON.stringify({ topicName:"v2.users.u1.routingStatus",
      eventBody:{ routingStatus:{ status:"INTERACTING" } } }));
    expect(e).toMatchObject({ userId:"u1", routingStatus:"INTERACTING" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/feed/gencloud/ws.test.ts` → Expected: FAIL.

- [ ] **Step 4: Implement `ws.ts`**

Port `splitTopics`, `parseNotification`, and `WsManager` from `rtm-dashboard/src/genesys/wsManager.ts`. Adapt `WsManager.subscribe` to take `(userIds, onEvent, onHeartbeat)`: for each chunk, `POST {apiBase}/api/v2/notifications/channels` (Bearer) → open `ws` to `connectUri` → `PUT .../channels/{id}/subscriptions` with the chunk → on message: if `parseNotification` returns null (heartbeat) call `onHeartbeat()`, else call `onEvent(evt)`. Reconnect with capped exponential backoff, fresh channel per reconnect (covers 24h expiry), re-subscribe on open; the returned teardown closes all sockets and stops reconnecting. Return value is `Promise<() => void>`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/feed/gencloud/ws.test.ts` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/feed/gencloud/ws.ts lib/feed/gencloud/ws.test.ts package.json package-lock.json
git commit -m "feat(gencloud): notifications WebSocket manager with channel splitting"
```

---

## Task 4: Roster + queue aggregation mappers

**Files:**
- Create: `lib/feed/gencloud/mappers.ts`
- Test: `lib/feed/gencloud/mappers.test.ts`

**Interfaces:**
- Consumes: `QueueObs`, `QueueAgg` (Task 1).
- Produces:
  - `buildRoster(queues:{id:string;name:string}[], membersByQueue: Record<string,{id:string;name:string}[]>): { org: Team[]; agents: RosterAgent[]; idToName: Record<string,string> }` — one team per queue; agents deduped by id; each agent assigned to the FIRST queue (by input order) they appear in; `RosterAgent.state` seeded `"off"`.
  - `aggregateQueue(obs: QueueObs[], agg: QueueAgg[]): Queue` — `cq`=Σwaiting, `sl`=avg non-null serviceLevelPct (0 if none), `asa`=avg non-null asaSec (0 if none), `ab`=Σabandoned/Σoffered×100 (0 if no offered). Never NaN.
- `Team`, `RosterAgent`, `Queue` imported from `@/lib/types`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/feed/gencloud/mappers.test.ts
import { describe, it, expect } from "vitest";
import { buildRoster, aggregateQueue } from "./mappers";

describe("buildRoster", () => {
  it("one team per queue, agents deduped to first queue", () => {
    const r = buildRoster(
      [{id:"q1",name:"Alpha"},{id:"q2",name:"Bravo"}],
      { q1:[{id:"u1",name:"Amara"},{id:"u2",name:"Bea"}], q2:[{id:"u1",name:"Amara"}] });
    expect(r.org).toEqual([
      { team:"Alpha", tl:"", mgr:"", lob:"Alpha" },
      { team:"Bravo", tl:"", mgr:"", lob:"Bravo" }]);
    expect(r.agents.map(a=>[a.name,a.team])).toEqual([["Amara","Alpha"],["Bea","Alpha"]]);
    expect(r.agents.every(a=>a.state==="off")).toBe(true);
    expect(r.idToName.u1).toBe("Amara");
  });
});

describe("aggregateQueue", () => {
  it("aggregates across queues without NaN", () => {
    const q = aggregateQueue(
      [{queueId:"q1",waiting:3,interacting:0,onQueueUsers:0,offQueueUsers:0,serviceLevelPct:90},
       {queueId:"q2",waiting:2,interacting:0,onQueueUsers:0,offQueueUsers:0,serviceLevelPct:70}],
      [{queueId:"q1",offered:10,answered:9,abandoned:1,asaSec:20,avgHandleSec:300},
       {queueId:"q2",offered:0,answered:0,abandoned:0,asaSec:null,avgHandleSec:null}]);
    expect(q.cq).toBe(5);
    expect(q.sl).toBeCloseTo(80);
    expect(q.asa).toBeCloseTo(20);
    expect(q.ab).toBeCloseTo(10);
  });
  it("empty inputs -> zeros, not NaN", () => {
    const q = aggregateQueue([], []);
    expect(q).toEqual({ cq:0, sl:0, asa:0, ab:0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/feed/gencloud/mappers.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement `mappers.ts`** per the interfaces above.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/feed/gencloud/mappers.test.ts` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/feed/gencloud/mappers.ts lib/feed/gencloud/mappers.test.ts
git commit -m "feat(gencloud): roster (one-team-per-queue) and queue aggregation mappers"
```

---

## Task 5: GencloudFeed orchestration + runtime/env wiring

**Files:**
- Modify: `lib/feed/GencloudFeed.ts` (replace stub body)
- Modify: `lib/server/runtime.ts` (pass token/region/viewConfigId into GencloudFeed)
- Modify: `.env.example`
- Test: none new for the live orchestration (pure pieces are covered in Tasks 1–4); verified by typecheck + a documented manual run.

**Interfaces:**
- Consumes: `GencloudClient` (T1), `mapGenesysState` (T2), `WsManager` (T3), `buildRoster`/`aggregateQueue` (T4), `FeedHandlers`/`FeedSource` (existing).
- `GencloudConfig` extended to `{ apiBase?: string; token?: string; viewConfigId?: string; clientId?: string; clientSecret?: string }`.

- [ ] **Step 1: Implement `GencloudFeed.subscribe`**

On `subscribe(handlers)`:
1. Resolve config: `apiBase = config.apiBase ?? process.env.GENCLOUD_API_BASE ?? "https://api.mypurecloud.com"`; `token = config.token ?? process.env.GENESYS_TOKEN`; `viewConfigId = config.viewConfigId ?? process.env.RTM_VIEW_CONFIG_ID ?? "9c9f8fd2-acab-4282-9442-ddba152f9c18"`. If no token, leave the feed silent (do not throw at construction; the engine shows "Gencloud not responding") — log a single non-secret warning that the token is missing.
2. Build `GencloudClient`. Run an async bootstrap (don't block `subscribe`'s return): `getWatchedQueues()` → `getQueueMembers()` per queue → `buildRoster(...)` → `handlers.onRoster(roster)`; keep `idToName` and the queue id list.
3. Open `WsManager.subscribe(userIds, onEvent, handlers.onHeartbeat)`: in `onEvent`, accumulate per-user latest presence+routing, compute `mapGenesysState`, and call `handlers.onAgentState({ agent: idToName[userId], state })` (skip if the id isn't in the roster).
4. Start a poll loop (every 5s): `getObservations(queueIds)` + `getAggregates(queueIds, todayInterval)` → `aggregateQueue(...)` → `handlers.onQueue(q)` then `handlers.onHeartbeat()`. On a thrown 401/any error, skip this cycle (the lack of heartbeats makes the engine mark the floor stale) — do not crash the loop.
5. `subscribe` returns a teardown that stops the poll loop and tears down the WsManager.

Keep the bearer token out of all logs. Note inline (comment) the known v1 gaps: no `onHold`/`callEnded`/`adh` yet (needs conversation topics + WFM adherence), so AHT/short-call/transfer/hold/adherence rules stay quiet.

- [ ] **Step 2: Wire runtime + env**

In `lib/server/runtime.ts` `createLive`, extend the `new GencloudFeed({...})` config to also pass `token: process.env.GENESYS_TOKEN`, `apiBase: process.env.GENCLOUD_API_BASE`, `viewConfigId: process.env.RTM_VIEW_CONFIG_ID` (keep the existing clientId/clientSecret). In `.env.example`, add commented entries: `GENESYS_TOKEN=`, `GENCLOUD_API_BASE=https://api.mypurecloud.com`, `RTM_VIEW_CONFIG_ID=9c9f8fd2-acab-4282-9442-ddba152f9c18`, and a note that `NEXT_PUBLIC_FEED` must be set to something other than `sim` (e.g. `gencloud`) to use the live adapter.

- [ ] **Step 3: Verify typecheck + full suite**

Run: `npx tsc --noEmit` (clean) and `npx vitest run` (all green, including the new gencloud tests + the existing 32 engine tests).

- [ ] **Step 4: Commit**

```bash
git add lib/feed/GencloudFeed.ts lib/server/runtime.ts .env.example
git commit -m "feat(gencloud): wire live Genesys feed into GencloudFeed + runtime/env"
```

---

## Task 6: README + manual-run notes

**Files:**
- Modify: `README.md` (update the "Gencloud feed adapter" section from "Stub" to implemented, with run instructions and the v1 gaps)

- [ ] **Step 1: Update README**

Document: set `NEXT_PUBLIC_FEED=gencloud` (and `NEXT_PUBLIC_VIEW_AS=1`), `GENESYS_TOKEN` (hand-grabbed supervisor token from the browser Network tab, short-lived), `GENCLOUD_API_BASE`, `RTM_VIEW_CONFIG_ID`; `npm run dev` (works with `next dev -p <port>`); what shows up (live queues/agents on the watched view); and the v1 gaps (presence/routing + queue metrics are live; call-level data — AHT, short calls, transfers, holds — and WFM adherence need conversation topics + the adherence API, a later task; TL/Manager blank because org is one-team-per-queue).

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: Gencloud feed adapter run instructions and v1 scope"
```

---

## Self-Review

**Spec coverage:** onRoster → Tasks 1(queues/members)+4(buildRoster)+5; onAgentState → Tasks 2+3+5; onQueue → Tasks 1+4+5; onHeartbeat → Tasks 3+5; auth/env → Tasks 1+5; v1 one-team-per-queue → Task 4; known gaps documented → Tasks 5+6. All handler contract points covered.

**Placeholder scan:** Pure-logic tasks (1–4) carry verbatim tests + concrete contracts; the port source files are named exactly. Task 5 orchestration is described step-by-step with the exact env keys, call order, and teardown; no "TBD".

**Type consistency:** `QueueObs`/`QueueAgg` defined in Task 1 and consumed by Task 4; `mapGenesysState` signature stable T2→T5; `WsManager.subscribe(userIds,onEvent,onHeartbeat)` stable T3→T5; `buildRoster`/`aggregateQueue` returns consumed in T5; all feed payloads match `@/lib/types` (`AgentState`, `Team`, `RosterAgent`, `Queue`, `AgentStateEvent`).

**Review Focus:** 401→silent/stale (T1 throw + T5 skip-cycle), empty→no-NaN (T1 + T4 tests), roster>budget→split (T3 test), WS drop/expiry→reconnect (T3 impl), multi-queue agent dedupe (T4 test). Each pinned to an owning task.
