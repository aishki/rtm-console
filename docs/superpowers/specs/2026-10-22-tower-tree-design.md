# Agent grid grouped by tower

Date: 2026-10-22

## Why

A supervisor opens the console to see **how their whole tower is doing right now**. Today the agent grid
groups by Genesys queue: 90 flat groups, each agent shown only under the first queue they belong to, and
the call numbers (calls in queue, SL, ASA, abandon) exist only as one floor-wide total. Nothing answers
"how is ROM East doing?" at a glance.

WFM now maintains a queue-to-LOB mapping (Tower → Sub-tower → LOB → queue, with region and org). The grid
should use it.

## What it looks like

The agent grid becomes a tree:

**Tower → Sub-tower → LOB → Queue → Agents**

- Every level is a collapsible row. Agent cards appear only inside an open queue.
- Each row's header shows, in this order:
  1. **Calls**: calls in queue, service level, ASA, abandon %. Calls come first, at the user's request.
  2. **Agent mix**: the existing state-mix bar (on call, available, ACW, aux, offline) and counts.
  3. The breaching count, and the number of queues and agents under the row.
- With today's 90 watched queues the tree is: Provider Services → CSBD - Provider → five LOBs
  (ROM EAST 33 queues, ROM CENTRAL 27, ROM WEST 21, NATIONAL WGS 4, Facets - Provider 4). One watched
  queue is not in the mapping.

A mockup of the agreed shape (before LOB was confirmed as a level) is in
`.superpowers/brainstorm/1556-1792670064/content/tower-tree.html`.

## Decisions (made by the user)

- Grouping is Tower → Sub-tower → **LOB** → Queue → Agents. LOB was added because every watched queue
  shares one tower and one sub-tower; without it the tree is a flat list of 90 queues.
- Headers show both calls and agent mix, **calls first**.
- **An agent appears under every queue they belong to**, not once in a home queue.
- **An admin uploads the mapping spreadsheet in the console** when WFM sends a new one.

## Decisions (my calls, open to change)

- **Roll-up of call numbers.** A parent's calls in queue is the sum of its queues. SL, ASA and abandon
  are weighted by calls, not averaged per queue, using the same formula as the existing floor total
  (`aggregateQueue` in `lib/feed/gencloud/mappers.ts`). SL with no counted calls shows "—", not 0%.
- **Roll-up of people.** Above the queue level each person counts once: "ROM EAST · 188 agents", not the
  sum of 33 queue memberships. Same for the mix bar and the breaching count.
- **Unmapped queues** go under an "Unmapped" tower at the end, so nothing disappears silently.
- **Default open state.** Towers, sub-towers and LOBs start open; queues start closed. So the first screen
  shows every LOB's header (the "how is my tower doing" view) without thousands of agent cards. Filtering
  or searching opens the branches that contain matches, as filtering does today.
- **Header colour.** Call numbers use the existing rule thresholds (SL target, calls-in-queue alert,
  abandon alert) to colour warn/crit, as the KPI tiles already do.
- **Upload.**
  - Accepts the `.xlsx` WFM sends. It finds the sheet named `Queue-to-LOB mapping` and its columns by
    header, ignoring case, spaces and hyphens. So `Sub Tower` and `Sub -Tower`, and `Queues` and `Queue`,
    all match. Required: Tower, Sub-tower, LOB, Queue. Region and Org are read if present.
  - The two real files (`RTM Provider.xlsx`, `RTM Console Framework - MS.xlsx`, from WFM, 2026-10-22)
    were checked. In both, that sheet is a plain table with headers on row 1 and no merged cells. Every
    row has every column filled. Column order differs between the files: Provider has
    `Tower | Sub Tower | LOB | Queues | Region | Org`, MS has `Region | Org | Queues | Tower | Sub -Tower | LOB`.
    Both workbooks also contain other sheets (rosters, a pivot), which are ignored. A row with a blank
    required cell is skipped and reported; values are not carried down. Real files are not committed
    because they hold staff names. Build test fixtures with the same headers and a few made-up rows.
  - WFM sends one file per area: Provider Services and Member Services today. **An upload replaces the
    rows for every tower that appears in it and keeps the other towers.** Uploading the Member Services
    file does not wipe Provider Services.
  - Queue names are matched to Genesys queue names ignoring case and surrounding spaces. A queue that
    appears twice with different LOBs (the MS file has 4 such) uses the first row. The upload result lists
    each duplicate so the admin can send it back to WFM.
  - The upload reports how many queues it mapped, which watched queues are still unmapped, and any rows
    it skipped and why.
  - Stored server-side in `.rtm/queue-map.json` (gitignored, like the token and roster: queue names are
    internal). It survives restarts and applies to the live floor without a restart.
  - Permission: **Admin only, and it works on every floor, including the live Genesys feed.** Do not
    reuse `authorizeImport()` (`lib/server/guard.ts`). It also lets managers in (`replay` flag), and it
    refuses on the live feed. Use a new check on an admin-only permission, e.g. the `feed` flag or a new
    `mapping` flag. Until SSO exists anyone can pick Admin under "View as". That is accepted here because
    a mapping is easy to re-upload. The token page is stricter because a token is a credential.
- **Scoping in the tree.** A queue lists only the agents in the viewer's scope (`scopeAgents`), and its
  header counts only them. Today this changes nothing: live Genesys queues have no lead or manager, so
  leader views see everyone. Once leads are filled in, a lead sees only their own people under each
  queue.
- **Simulation floor (user's decision: invent per-queue call numbers).** The simulator treats each of its
  teams as a queue. When it seeds from the cached roster (`seedFromRoster` in `lib/feed/SimFeed.ts`)
  those teams are real queue names, so an uploaded mapping gives it a real tree. Sample teams with no
  mapping go under "Unmapped"; no fake tree is invented. The simulator generates calls in queue, SL, ASA
  and abandon **for each queue**. Today it runs one floor-wide random walk (`SimFeed.ts` around line 177).
  - My call: the floor total it reports is the roll-up of its per-queue numbers, using the same weighting
    as the tree, so the tiles and the tree headers agree.
  - My call: the per-queue numbers are scaled so the floor total stays in today's range. The floor queue
    rules (calls-in-queue, SL, abandon) then fire about as often as they do now.
  - My call: some queues run hot and others quiet, so the tree shows contrast.
  - This needs `FeedHandlers` (`lib/feed/FeedSource.ts`) to carry per-queue numbers alongside the floor
    total. The Gencloud feed uses the same path.
- **CSV replay.** Replay files carry only floor-level queue numbers, so call numbers in replay tree
  headers show "—". The KPI tiles keep the floor numbers. Changing the replay format is out of scope.

## Goals

- From the first screen, a supervisor can read each LOB's (and tower's) calls and agent mix.
- A new WFM spreadsheet goes live by uploading it, with no code change or restart.

## Non-goals

- Multi-org or multi-region feeds. The tree is built from whatever queues the current feed watches. The
  Region and Org columns are stored for later but not shown or used to fetch anything now.
- Filtering by manager or team from WFM's agent roster sheets. Those sheets are not imported here.
- Changing who is in which queue. Membership always comes from Genesys.
- Changing how rules, incidents, the ledger or role scoping work. Each agent keeps one primary team for
  those (see Constraints).

## Anti-goals

- Inflated numbers: an agent in 30 queues must not count as 30 agents anywhere above the queue level.
- A first screen that renders thousands of agent cards and becomes slow. ROM East queues have about 600
  members each and the same people repeat across queues.
- Queues silently dropped because the mapping is out of date.

## Constraints and what exists today

- `Agent.team` is a single string, used by scoping (`lib/engine/scope.ts`), incidents, the ledger,
  escalation, push alerts, dashboards and CSV export. The tree needs each agent's **full queue
  membership**, but `team` must keep working for everything else. The builder chooses how to carry
  membership. One option is a `queues: string[]` on the agent, with `team` left as today's first queue.
- `buildRoster` (`lib/feed/gencloud/mappers.ts`) already sees every queue's members, but it drops repeats.
  Membership has to be kept from there.
- Queue numbers are polled per queue (`obs` and `agg`, grouped by `queueId` in
  `lib/feed/gencloud/client.ts`) and then collapsed into one floor total by `aggregateQueue`. The tree
  needs the per-queue numbers kept and sent to the client as well. The floor total and the KPI tiles stay
  as they are.
- Uploads already have helpers: `lib/server/upload.ts` and `lib/import/xlsx.ts` (exceljs).
- The existing team filter in `AgentGridToolbar` is a list of queues. It should keep working against
  queues, and the builder may group its options by LOB.
- Next.js here is a newer version with breaking changes. Read `node_modules/next/dist/docs/` before
  writing route or page code (see `AGENTS.md`).

## Left to the builder

- Where the per-queue numbers and membership live in the store and the stream, and their exact shapes.
- Component structure for the tree rows (reuse or generalise `TeamGroup`).
- Where the upload control lives in the UI (next to the existing import, or an admin page).
- Rendering approach for large open queues (e.g. a cap with "show all", or virtualisation), provided the
  default first screen stays light.
