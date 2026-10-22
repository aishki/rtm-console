# Agent Grid Grouped by Tower: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The console's agent grid groups by Tower → Sub-tower → LOB → Queue → Agents. Each row shows call
numbers first, then the agent mix. The mapping comes from a WFM spreadsheet that an admin uploads.

**Architecture:**
- **Feeds** report per-queue call counts and full queue membership alongside what they send today.
  - Gencloud already polls per queue.
  - The simulator invents its counts.
  - CSV replay sends none.
- **The engine** keeps both, and the stream sends both to the client. Membership is resent only when the
  roster changes. The uploaded mapping is stored on the server and resent only when it changes.
- **The client** builds the tree with a pure function, then rolls up calls and people per node.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zustand store (`lib/client/store.ts`),
exceljs, Vitest (node env, `lib/**/*.test.ts` only).

**Spec:** `docs/superpowers/specs/2026-10-22-tower-tree-design.md`

## Global Constraints

- Read `node_modules/next/dist/docs/` before writing route or page code. This Next.js has breaking
  changes (`AGENTS.md`).
- Queue names match between sheet and Genesys **ignoring case and surrounding spaces**.
- Above the queue level, **each person counts once** (agents, mix bar, breaching).
- SL, ASA and abandon roll up **weighted by calls**: the same formula as today's `aggregateQueue`.
  SL with no counted calls is `null` and shows "—".
- Mapping upload: **Admin only**. It works on every floor, **including the live Genesys feed**. Never
  reuse `authorizeImport()`.
- An upload **replaces the rows of every tower in the file and keeps the other towers**.
- Mapping is stored in `.rtm/queue-map.json`. `.rtm/` is already gitignored. Never commit real
  spreadsheets: they hold staff names.
- Design rules (README): no shadows, no gradients, no entrance animations, sentence case, no emoji.
  Use the existing BITS tokens and Tailwind classes, matching `components/console/TeamGroup.tsx`.
- Run `npm test`, `npm run typecheck` and `npm run lint` before every commit. All three must pass.

## Review Focus

1. **The sheet and Genesys spell a queue differently** (case, trailing space): the queue must still land
   in its LOB, not in "Unmapped". Tested in Task 3.
2. **The wrong file is uploaded**: a CSV, a workbook without a `Queue-to-LOB mapping` sheet, or a sheet
   missing a required column. The admin gets one clear error and the stored mapping is untouched. Tested
   in Tasks 2 and 6.
3. **A queue with no call data yet** (first poll pending, or a CSV replay): its header shows "—" for
   every call number, not 0 or 0%. A parent with some data rolls up only the queues that have it. Tested
   in Task 1.
4. **The roster reloads mid-shift** (Gencloud reconnects, members change): clients receive the new
   membership without reconnecting. Tested in Task 7.
5. **An agent in 30 queues of one LOB** counts as 1 in that LOB's header, its mix bar and its breaching
   count. Tested in Task 3.

---

### Task 1: Per-queue counts and the roll-up

**Files:**
- Modify: `lib/types.ts` (add `QueueCounts`)
- Create: `lib/queueStats.ts`
- Modify: `lib/feed/gencloud/mappers.ts` (`aggregateQueue` delegates to `rollUp`)
- Test: `lib/queueStats.test.ts`, existing `lib/feed/gencloud/mappers.test.ts` must stay green

**Interfaces:**
- Produces:
  - `interface QueueCounts { waiting: number; offered: number; answered: number; abandoned: number; answerSec: number; slWithin: number; slCounted: number }` in `lib/types.ts`
  - `rollUp(counts: QueueCounts[]): Queue | null` in `lib/queueStats.ts`. `null` when `counts` is empty.
  - `queueKey(name: string): string` in `lib/queueStats.ts`, which returns `name.trim().toUpperCase()`.

- [ ] **Step 1: Write the failing tests** in `lib/queueStats.test.ts`

```ts
const c = (p: Partial<QueueCounts>): QueueCounts => ({ waiting: 0, offered: 0, answered: 0, abandoned: 0, answerSec: 0, slWithin: 0, slCounted: 0, ...p });
it("weights by calls, not by queue", () => {
  const q = rollUp([c({ waiting: 2, offered: 700, answered: 690, abandoned: 10, answerSec: 690 * 20, slWithin: 630, slCounted: 700 }),
                    c({ waiting: 5, offered: 10, answered: 5, abandoned: 5, answerSec: 5 * 100, slWithin: 1, slCounted: 10 })])!;
  expect(q.cq).toBe(7);
  expect(q.sl).toBeCloseTo((631 / 710) * 100);
  expect(q.asa).toBeCloseTo((690 * 20 + 500) / 695);
  expect(q.ab).toBeCloseTo((15 / 710) * 100);
});
it("has no service level before any call is counted", () => expect(rollUp([c({ waiting: 3 })])!.sl).toBeNull());
it("is null with no queues reporting", () => expect(rollUp([])).toBeNull());
it("keys queue names ignoring case and surrounding spaces", () => expect(queueKey("  csbd_x ")).toBe(queueKey("CSBD_X")));
```

- [ ] **Step 2: Run** `npx vitest run lib/queueStats.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `QueueCounts`, `rollUp` and `queueKey`. Also add
  `toCounts(obs: QueueObs[], agg: QueueAgg[]): Record<string, QueueCounts>` (keyed by `queueId`) in
  `mappers.ts`. Re-express `aggregateQueue(obs, agg)` as `rollUp(Object.values(toCounts(obs, agg))) ?? { cq: 0, sl: null, asa: 0, ab: 0 }`.
  Its existing tests must pass unchanged.

- [ ] **Step 4: Run** `npm test`. Expected: PASS, including `mappers.test.ts`.

- [ ] **Step 5: Commit** `feat: per-queue call counts and a call-weighted roll-up`

---

### Task 2: Parse and merge the WFM mapping spreadsheet

**Files:**
- Create: `lib/import/queueMap.ts`
- Test: `lib/import/queueMap.test.ts`

**Interfaces:**
- Consumes: `Sheet` / `Cell` types from `lib/import/floor.ts`. Rows come from `readSheets` in `lib/import/xlsx.ts`.
- Produces:
  - `interface QueueMapRow { tower: string; subTower: string; lob: string; queue: string; region?: string; org?: string }`
  - `type QueueMapParse = { ok: true; rows: QueueMapRow[]; skipped: { row: number; reason: string }[]; duplicates: { queue: string; kept: string; dropped: string }[] } | { ok: false; errors: string[] }`
  - `parseQueueMap(sheets: Record<string, Sheet>): QueueMapParse`
  - `mergeQueueMap(current: QueueMapRow[], incoming: QueueMapRow[]): QueueMapRow[]`

Rules from the spec:
- The sheet is `Queue-to-LOB mapping`, found ignoring case.
- Headers are on row 1. Each header is matched after lowercasing and removing spaces and hyphens. Aliases:
  - tower: `tower`
  - subTower: `subtower`
  - lob: `lob`
  - queue: `queue`, `queues`
  - region: `region`
  - org: `org`, `organization`
- Values are trimmed. A row with all cells empty is ignored silently. A row missing any required cell is
  skipped with reason `Missing <Column>`. `row` is the 1-based sheet row.
- A duplicate is a queue seen again, compared with `queueKey`. The first row wins. `kept` and `dropped`
  are the LOB labels.
- Merge: drop every current row whose `tower` appears in `incoming`, then append `incoming`.

- [ ] **Step 1: Write the failing tests.** Fixtures are made-up rows with the two real header layouts:
  - Provider: `Tower | Sub Tower | LOB | Queues | Region | Org`
  - MS: `Region | Org | Queues | Tower | Sub -Tower | LOB`

```ts
it("reads both WFM layouts by header name", ...)            // both give the same QueueMapRow for an equal row
it("refuses a workbook without the mapping sheet", () =>
  expect(parseQueueMap({ PIVOT: [["x"]] })).toEqual({ ok: false, errors: ["No sheet named \"Queue-to-LOB mapping\"."] }));
it("refuses a sheet missing a required column", () =>
  expect(parseQueueMap({ "Queue-to-LOB mapping": [["Tower", "LOB", "Queues"]] })).toEqual({ ok: false, errors: ["Missing column: Sub-tower."] }));
it("skips and reports a row with a blank required cell", ...) // skipped: [{ row: 3, reason: "Missing LOB" }]
it("keeps the first of a duplicated queue and reports it", ...) // CSBD_LGO_SG_CA_Bnfts_Mem under Small Group, then CA Traditional → kept "Small Group", dropped "CA Traditional"
it("replaces only the towers in the upload", () => {
  const p = (tower: string, queue: string): QueueMapRow => ({ tower, subTower: "s", lob: "l", queue });
  expect(mergeQueueMap([p("Provider Services", "A"), p("Member Services", "B")], [p("Member Services", "C")]))
    .toEqual([p("Provider Services", "A"), p("Member Services", "C")]);
});
```

- [ ] **Step 2: Run** `npx vitest run lib/import/queueMap.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `parseQueueMap` and `mergeQueueMap` in `lib/import/queueMap.ts`. The error
  strings are exactly as in the tests.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: read the WFM queue-to-LOB mapping spreadsheet`

---

### Task 3: Build the tower tree

**Files:**
- Create: `lib/queueTree.ts`
- Test: `lib/queueTree.test.ts`

**Interfaces:**
- Consumes: `QueueMapRow` (Task 2), `queueKey` (Task 1).
- Produces:
  - `type TreeLevel = "tower" | "subTower" | "lob" | "queue"`
  - `interface TreeNode { key: string; level: TreeLevel; label: string; queues: string[]; agentIds: number[]; children: TreeNode[] }`
    - `queues`: every queue name under the node, with the feed's spelling.
    - `agentIds`: the distinct agent ids under the node, in first-seen order.
  - `UNMAPPED = "Unmapped"`
  - `buildTree(queueNames: string[], map: QueueMapRow[], members: Record<string, number[]>): TreeNode[]`

Rules:
- Each mapped queue goes under tower → subTower → lob → queue.
- Unmapped queues sit directly under a single `Unmapped` tower node, which comes last. It has no
  sub-tower or LOB levels.
- Siblings sort by label with `localeCompare`.
- `key` is the path of labels joined with `/`, each prefixed by its level initial, e.g.
  `t:Provider Services/s:CSBD - Provider/l:ROM EAST/q:CSBD_X`.
- A queue node's `agentIds` is `members[queueName] ?? []`.
- Nodes with no queues are not created.
- `queueNames` that repeat once keyed are kept once.

- [ ] **Step 1: Write the failing tests**

```ts
it("nests tower → sub-tower → LOB → queue", ...)      // labels and levels along one path
it("matches sheet names to feed names ignoring case and spaces", () => {
  const t = buildTree(["csbd_cnx_host_prov_east_ga "], [row("Provider Services", "CSBD - Provider", "ROM EAST", "CSBD_CNX_HOST_PROV_EAST_GA")], {});
  expect(t[0].label).toBe("Provider Services");
  expect(t[0].children[0].children[0].children[0].label).toBe("csbd_cnx_host_prov_east_ga ");
});
it("puts unmapped queues last, directly under Unmapped", ...)
it("counts a person once above the queue level", () => {
  const t = buildTree(["Q1", "Q2"], [row("T", "S", "L", "Q1"), row("T", "S", "L", "Q2")], { Q1: [1, 2], Q2: [2, 3] });
  expect(t[0].agentIds).toEqual([1, 2, 3]);
  expect(t[0].children[0].children[0].children.map(q => q.agentIds)).toEqual([[1, 2], [2, 3]]);
});
it("is a flat Unmapped tower with no mapping", ...)  // simulator sample teams
```

- [ ] **Step 2: Run** `npx vitest run lib/queueTree.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `buildTree`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: build the tower, sub-tower, LOB and queue tree`

---

### Task 4: Feeds and engine carry membership and per-queue counts

**Files:**
- Modify: `lib/types.ts` (`Roster.members?`)
- Modify: `lib/feed/FeedSource.ts` (`onQueue` signature)
- Modify: `lib/engine/escalation.ts` (`EngineState` fields)
- Modify: `lib/engine/engine.ts` (`onRoster`, `onQueue`, `tick`, `reset`)
- Modify: `lib/feed/gencloud/mappers.ts` (`buildRoster` returns `members`)
- Modify: `lib/feed/GencloudFeed.ts` (`startPoll` takes `{ id, name }[]` and emits per-queue counts keyed by queue **name**)
- Modify: `lib/feed/CsvReplayFeed.ts` (call sites only, no per-queue counts)
- Test: `lib/engine/engine.test.ts`, `lib/feed/gencloud/mappers.test.ts`

**Interfaces:**
- Consumes: `QueueCounts`, `toCounts` (Task 1).
- Produces:
  - `Roster` gains `members?: Record<string, string[]>`: queue name → agent names.
  - `FeedHandlers.onQueue(queue: Queue, byQueue?: Record<string, QueueCounts>): void`. `byQueue` is keyed by queue name.
  - `EngineState` gains:
    - `queues: Record<string, QueueCounts>`: the latest per-queue counts. `{}` until a feed sends them.
    - `members: Record<string, number[]>`: queue name → agent ids.
    - `rosterRev: number`: incremented on every `onRoster`.
  - `buildRoster(...)` also returns `members: Record<string, string[]>`. That is every kept member of
    each queue by queue name, **including agents already placed under an earlier queue**. `team` stays
    the agent's first queue.

Engine rules:
- `onRoster` sets `S.members` from `r.members` by mapping names to the new agent ids. Unknown names are
  dropped.
- Without `r.members`, it derives `{ [team]: [ids of agents whose team is team] }` for every org team.
  This covers the simulator and replay.
- `queues` is applied on the same tick as `queue`, like `pendingQueue`. `reset` clears `queues`,
  `members` and `rosterRev` to `{}`, `{}` and `0`.

- [ ] **Step 1: Write the failing tests**

```ts
// engine.test.ts
it("keeps every queue an agent belongs to", ...)       // roster members { Q1: ["A","B"], Q2: ["B"] } → S.members { Q1: [idA,idB], Q2: [idB] }
it("derives membership from teams when the feed sends none", ...)
it("bumps rosterRev on each roster", ...)
it("stores per-queue counts with the floor numbers", ...) // onQueue(q, { Q1: counts }) then tick → S.queues.Q1 equals counts
// mappers.test.ts
it("lists an agent under every queue they are in", ...)  // buildRoster: agents once, members has the agent under both queues
```

- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** In `GencloudFeed`, pass the queues (`{ id, name }`) to `startPoll`. Build
  `byQueue` by renaming `toCounts` keys from id to name, then call
  `handlers.onQueue(aggregateQueue(obs, agg), byQueue)`. Thread `members` from `buildRoster` into
  `onRoster`. `remembering()` in `lib/server/runtime.ts` and `saveRoster` need no change: membership is
  not cached.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: feeds report queue membership and per-queue call counts`

---

### Task 5: The simulator invents per-queue call numbers

**Files:**
- Modify: `lib/feed/SimFeed.ts` (replace the single floor walk in `tickQueue` with one walk per team)
- Test: `lib/feed/SimFeed.test.ts`

**Interfaces:**
- Consumes: `QueueCounts`, `rollUp` (Task 1). `onQueue(queue, byQueue)` (Task 4).
- Produces: every tick, `onQueue(rollUp(Object.values(byQueue))!, byQueue)` with one entry per seed team, keyed by team name.

Rules from the spec:
- The floor total is the roll-up of the per-team numbers, so the tiles and the tree agree.
- Per-team numbers are scaled so the floor total stays in today's range: `cq` mostly 0–8 with
  occasional spikes, and SL about 45–99. The floor queue rules then fire about as often as now.
- Each team gets a fixed "heat" drawn at construction, so some queues run hot and others quiet.
- Counts accumulate (`offered`, `answered` and the rest only grow) because they are "today" totals.
- Agents' move from available to on-call keeps reading the floor `cq` (`SimFeed.ts:131`).

- [ ] **Step 1: Write the failing tests.** Use a seeded `rnd` (e.g. a small LCG) so they are deterministic.

```ts
it("reports numbers for every team, and a floor total that is their roll-up", ...)
it("keeps the floor in today's range over a shift", () => {
  // 3 600 ticks: mean floor cq between 1 and 8, every sl between 45 and 99 when not null
});
it("runs some queues hotter than others", ...) // after 1 800 ticks, max team SL − min team SL ≥ 10
it("only grows the day's counts", ...)
```

- [ ] **Step 2: Run** `npx vitest run lib/feed/SimFeed.test.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** the per-team walks in `SimFeed`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS, including the existing simulator and engine tests.
- [ ] **Step 5: Commit** `feat: the simulator invents call numbers per queue`

---

### Task 6: Store the mapping and let an Admin upload it

**Files:**
- Modify: `lib/types.ts` (`Perms.mapping: boolean`)
- Modify: `lib/engine/scope.ts` (`mapping: true` for admin only)
- Modify: `lib/server/guard.ts` (add `"mapping"` to `Flag`)
- Create: `lib/server/queueMapStore.ts`
- Create: `app/api/admin/queue-map/route.ts`
- Modify: `lib/client/api.ts` (`uploadQueueMap`)
- Test: `lib/server/queueMapStore.test.ts`

**Interfaces:**
- Consumes: `parseQueueMap`, `mergeQueueMap`, `QueueMapRow` (Task 2). `queueKey` (Task 1).
  `uploadedFile`, `isWorkbook` (`lib/server/upload.ts`). `readSheets` (`lib/import/xlsx.ts`).
- Produces:
  - `loadQueueMap(): QueueMapRow[]`, `saveQueueMap(rows: QueueMapRow[]): void`, `queueMapRev(): number`
    in `lib/server/queueMapStore.ts`.
    - The file is `.rtm/queue-map.json`.
    - The rows are cached in memory on `globalThis`, like the runtime registry, so a dev reload keeps them.
    - The rev starts at 1 and increments on every save.
  - `POST /api/admin/queue-map` (multipart `file`) → 200 `QueueMapResult`. Errors use the existing `deny`
    and `importErrors`.
  - `interface QueueMapResult { queues: number; towers: string[]; unmappedWatched: string[]; skipped: { row: number; reason: string }[]; duplicates: { queue: string; kept: string; dropped: string }[] }`
    - `queues`: the number of rows stored after the merge.
    - `towers`: the towers replaced by this upload.
    - `unmappedWatched`: `liveRuntime().engine.S.org` team names with no row after the merge.
  - `api.uploadQueueMap(file: File): Promise<QueueMapResult>`.

Route rules:
- `authorizeFor("mapping")`, so 403 for non-admins. Do not check the floor source: it works on the
  live feed.
- Not a workbook → 400 `Upload the .xlsx file WFM sends.`
- A parse failure → `importErrors(errors)`. Nothing is saved.

- [ ] **Step 1: Write the failing tests** for the store. Point it at a temp directory via an optional
  `dir` parameter or an env var, your choice. Cover:
  - an empty list when no file exists;
  - save then load round-trips;
  - the rev increments on save;
  - a corrupt file loads as an empty list.
- [ ] **Step 2: Run** `npx vitest run lib/server/queueMapStore.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the store, the perms flag, the route and `api.uploadQueueMap`. Follow the
  route-handler conventions in `node_modules/next/dist/docs/` and the existing `app/api/replay/route.ts`.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: Verify by hand** with `npm run dev`, View as Admin.
  - POST a made-up mapping `.xlsx`: it returns `QueueMapResult`.
  - As Manager: 403.
  - Upload a `.csv`: 400 with the message above.
  - With the floor on Gencloud: still accepted.
- [ ] **Step 6: Commit** `feat: admins upload the queue-to-LOB mapping`

---

### Task 7: Stream per-queue counts, membership and the mapping

**Files:**
- Modify: `lib/types.ts` (`TickMsg` fields)
- Modify: `lib/server/snapshot.ts` (`tickMsg` signature)
- Modify: `app/api/stream/route.ts` (track what each subscriber has)
- Modify: `lib/client/store.ts` (keep the last `members` and `queueMap`)
- Test: `lib/server/snapshot.test.ts`

**Interfaces:**
- Consumes: `S.queues`, `S.members`, `S.rosterRev` (Task 4). `loadQueueMap`, `queueMapRev` (Task 6).
- Produces:
  - `TickMsg` gains:
    - `queues: Record<string, QueueCounts>`: every tick, unscoped. Queue numbers are floor-visible
      to all leaders.
    - `members?: Record<string, number[]>`: only the agent ids in the viewer's scope (`scopeAgents`).
    - `queueMap?: QueueMapRow[]`.
  - `interface Since { rev: number; rosterRev: number; mapRev: number }`
  - `tickMsg(rt: Runtime, view: View, since: Since | null, batch: Batch): TickMsg`
    - `members` is sent when `since` is null or `since.rosterRev !== S.rosterRev`.
    - `queueMap` is sent when `since` is null or `since.mapRev !== queueMapRev()`.
    - The ledger keeps using `since.rev`.
  - Client store state gains `queues`, `members` and `queueMap`. `members` and `queueMap` keep their
    previous value when a tick omits them. An `init` without them resets to `{}` and `[]`.

- [ ] **Step 1: Write the failing tests** in `lib/server/snapshot.test.ts`. Use a sim runtime, or a
  minimal `Runtime` stub around `createEngine`.

```ts
it("sends membership and the mapping on the first snapshot", ...)
it("leaves them out while nothing changed", ...)      // since = current revs → members and queueMap undefined
it("resends membership after the roster reloads", ...)  // second onRoster → members present
it("scopes membership to the viewer's agents", ...)     // TL view: only ids of that TL's agents
```

- [ ] **Step 2: Run** `npx vitest run lib/server/snapshot.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The stream route keeps a `Since` per subscriber and advances it after each
  send. `initMsg` calls `tickMsg(..., null, ...)`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: stream per-queue counts, queue membership and the mapping`

---

### Task 8: The tree on the agent grid, and the upload dialog

**Files:**
- Create: `components/console/TreeGroup.tsx`
- Create: `components/console/QueueMapDialog.tsx`
- Modify: `app/(console)/console/page.tsx` (`AgentGrid` renders the tree)
- Modify: `components/console/AgentGridToolbar.tsx` (queue filter options grouped by LOB)
- Delete: `components/console/TeamGroup.tsx` once nothing imports it

**Interfaces:**
- Consumes: `buildTree`, `TreeNode` (Task 3). `rollUp` (Task 1). Store `queues`, `members`, `queueMap`
  (Task 7). `api.uploadQueueMap`, `QueueMapResult` and `Perms.mapping` (Task 6). `isBreach`, `thrOf`,
  `STATES` (`lib/engine/rules`).
- Produces: `TreeGroup({ node, depth, agentsById, shownIds, queues, rules, expanded, onToggle, query, showMetrics })`.
  It is recursive and renders the children of open non-queue nodes and the agent cards of open queue nodes.

Behaviour:
- **Header columns, in order:**
  - chevron;
  - label, with a sub-line `N queues · M agents · K breaching` (queue rows show only agents);
  - in queue, SL, ASA, Abn;
  - the mix bar.
- **Call numbers** are `rollUp(node.queues.map(q => queues[q]).filter(Boolean))`. When it is `null`,
  every call cell shows "—". When `sl` is `null`, show "—".
- **Colours** use the KPI tile thresholds in `useKpis` in `page.tsx`: `cq > thr("cq")` crit; `sl < thr("sl")`
  crit and `< thr("sl") + 5` warn; `ab > thr("aband")` crit. Extract one shared helper so tiles and
  rows can't drift.
- **Mix bar and breaching** come from `node.agentIds` (already distinct) mapped to agents, with the same
  `MIX` as `TeamGroup` today. Move `MIX` into the new file.
- **Indent** each level by 20px. On narrow panels drop the numeric mix text first and keep the bar,
  as `TeamGroup` does with container queries.
- **Default open:** every non-queue node is open and queues are closed. Expand state is keyed by
  `node.key`. Keep the `f:` prefix so the filtered view has its own expand state, as today.
- **Filtering** (search, state, quick filters, queue filter):
  - A queue node shows only matching agents. Nodes with no matches are hidden.
  - While filtering, the nodes that contain matches open.
  - The queue filter limits the tree to that queue's path.
- **Large queues:** an open queue renders at most 100 cards, then a "Show all N" button for that queue.
- **Panel sub-line** reads `T towers · Q queues · A agents`.
- **Upload:** when `usePerms()?.mapping`, the panel head shows an outline "Queue mapping" button that
  opens `QueueMapDialog`. The dialog:
  - takes an `.xlsx`, calls `api.uploadQueueMap`, and shows the result: queues stored, towers replaced,
    unmapped watched queues, skipped rows and duplicates;
  - shows the server's `error` on failure.

  Follow the look of `components/chrome/CsvImportDialog.tsx`.

- [ ] **Step 1: Build** `TreeGroup`, the `AgentGrid` changes and `QueueMapDialog`.
- [ ] **Step 2: Run** `npm run typecheck && npm run lint && npm test`. Expected: PASS.
- [ ] **Step 3: Verify in the browser** with `npm run dev` and the simulator floor. Use the `run` skill
  or Claude in Chrome.
  - With no mapping, the simulator's teams appear under "Unmapped", with numbers that change.
  - Upload a made-up mapping that names two of the simulator's teams. They move into their
    Tower → Sub-tower → LOB without a reload.
  - The parent numbers match the roll-up of the children: the sum for in queue, and between the
    children's values for SL.
  - A search opens only matching branches.
  - Switch View as to Manager: the "Queue mapping" button is gone.
- [ ] **Step 4: Verify on Gencloud** if a valid US East token is available. Upload `RTM Provider.xlsx`
  from Downloads. Expect Provider Services → CSBD - Provider → 5 LOBs, and 1 queue under "Unmapped".
  If no token is available, say so in the hand-off instead.
- [ ] **Step 5: Commit** `feat: agent grid grouped by tower, sub-tower, LOB and queue`
- [ ] **Step 6: Update README.** Add a short "Queue mapping" section: who can upload it, the file it
  expects, that an upload replaces only the towers in it, and where it is stored. Commit
  `docs: queue mapping upload`.
