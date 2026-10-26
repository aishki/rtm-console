# Graph Report - rtm-dashboard  (2026-10-26)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1035 nodes · 2868 edges · 44 communities (32 shown, 12 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 28 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `99a7a368`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- runtime.ts
- engine.ts
- rules.ts
- .subscribe
- SimFeed.ts
- index.d.ts
- package.json
- queueMap.ts
- floor.ts
- CsvImportDialog.tsx
- gate.ts
- gen.mjs
- DevBar.tsx
- ledger/page.tsx
- useConsole
- dashboards/page.tsx
- shims/store.ts
- compilerOptions
- types.ts
- build_pdf.py
- react
- build.mjs
- tokenStore.ts
- push.ts
- RuleRow.tsx
- client/alerts.ts
- demo.ts
- ContextBar.tsx
- check.mjs
- list-queues.mjs
- client/store.ts
- sw.js
- shims/alerts.ts
- jsx-runtime.js
- next-image.tsx
- postcss.config.mjs
- INC
- LVL
- NO_FILTERS
- SEV
- STATES
- TGT
- TOAST

## God Nodes (most connected - your core abstractions)
1. `useConsole` - 37 edges
2. `deny()` - 35 edges
3. `react` - 32 edges
4. `PurpleButton()` - 24 edges
5. `createEngine()` - 23 edges
6. `Team` - 22 edges
7. `authorizeFor()` - 22 edges
8. `Instance` - 21 edges
9. `authorize()` - 21 edges
10. `vitest` - 21 edges

## Surprising Connections (you probably didn't know these)
- `Props` --references--> `Rule`  [EXTRACTED]
  components/rules/RuleRow.tsx → lib/types.ts
- `Props` --references--> `Instance`  [EXTRACTED]
  components/console/TriggerCard.tsx → lib/types.ts
- `ToastItem` --references--> `ToastKind`  [EXTRACTED]
  tools/design-system/shims/store.ts → lib/types.ts
- `Props` --references--> `AgentState`  [EXTRACTED]
  components/chrome/PersonSearch.tsx → lib/types.ts
- `POST()` --calls--> `mergeQueueMap()`  [EXTRACTED]
  app/api/admin/queue-map/route.ts → lib/import/queueMap.ts

## Import Cycles
- None detected.

## Communities (44 total, 12 thin omitted)

### Community 0 - "runtime.ts"
Cohesion: 0.06
Nodes (72): POST(), POST(), POST(), POST(), POST(), POST(), POST(), DELETE() (+64 more)

### Community 1 - "engine.ts"
Cohesion: 0.05
Nodes (75): GET(), GET(), GET(), dynamic, GET(), runtime, incidentsCsv(), ledgerCsv() (+67 more)

### Community 2 - "rules.ts"
Cohesion: 0.06
Nodes (68): AgentGrid(), plural(), queueOptions(), useKpis(), MyViewPage(), AgentCard, Name(), Props (+60 more)

### Community 3 - ".subscribe"
Cohesion: 0.06
Nodes (45): AgentHandle, GencloudClient, GencloudClientConfig, Json, num(), parseAgentHandle(), parseAggregates(), parseObservations() (+37 more)

### Community 4 - "SimFeed.ts"
Cohesion: 0.05
Nodes (37): Props, GridFilters, ReplayEvent, Target, Floor, CsvReplayFeed, REPLAY_SPEED, ReplayExtras (+29 more)

### Community 5 - "index.d.ts"
Cohesion: 0.04
Nodes (52): Agent, AgentCardProps, AgentGridToolbarProps, AgentState, BitsLogoProps, CarelonLogoProps, CarelonMarkProps, Column (+44 more)

### Community 6 - "package.json"
Cohesion: 0.04
Nodes (44): eslintConfig, dependencies, exceljs, next, react, react-dom, web-push, ws (+36 more)

### Community 7 - "queueMap.ts"
Cohesion: 0.08
Nodes (35): big(), NONE, row(), small(), Cell, mergeQueueMap(), norm(), OPTIONAL (+27 more)

### Community 8 - "floor.ts"
Cohesion: 0.10
Nodes (34): GET(), defaultRules(), blank(), buildFloorImport(), capped(), COLUMNS, HoldEvent, ImportResult (+26 more)

### Community 9 - "CsvImportDialog.tsx"
Cohesion: 0.13
Nodes (31): fromCsv(), parseJson(), COLUMNS, count(), CsvImportDialog(), Loaded, LoadedCsv, LoadedWorkbook (+23 more)

### Community 10 - "gate.ts"
Cohesion: 0.13
Nodes (24): POST(), inter, metadata, Home(), clearFailures(), Count, g, GATE_COOKIE (+16 more)

### Community 11 - "gen.mjs"
Cohesion: 0.07
Nodes (24): branch, C, colors, css, grab(), header, here, literal() (+16 more)

### Community 12 - "DevBar.tsx"
Cohesion: 0.12
Nodes (26): TriggerFeed(), IncidentAction(), ReasonInput(), DataSource(), DevBar(), NotificationMenu(), NotificationSwitches(), ROLE_OPTIONS (+18 more)

### Community 13 - "ledger/page.tsx"
Cohesion: 0.15
Nodes (24): COLUMNS, STAGE_FILTERS, LOG_COLUMNS, TARGET_COLUMNS, VISIBILITY, Ladder(), Props, TriggerCard (+16 more)

### Community 14 - "useConsole"
Cohesion: 0.19
Nodes (21): ConsolePage(), ConsoleLayout(), HEADERS, RulesPage(), ConsoleShell(), Footer(), Navbar(), NudgePopup() (+13 more)

### Community 15 - "dashboards/page.tsx"
Cohesion: 0.14
Nodes (19): Bar, BarChart(), Counts, DashboardsPage(), DISPOSITION_OPTIONS, NO_DISPOSITION, tally(), TEAM_COLUMNS (+11 more)

### Community 16 - "shims/store.ts"
Cohesion: 0.12
Nodes (9): ToastItem, ToastKind, api, ApiError, State, subs, subscribe(), ToastItem (+1 more)

### Community 17 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 18 - "types.ts"
Cohesion: 0.16
Nodes (14): ConsoleState, EngineHooks, Batch, FeedKind, InitMsg, NudgeEvent, PeopleDirectory, ReplayMeta (+6 more)

### Community 19 - "build_pdf.py"
Cohesion: 0.15
Nodes (4): browser(), main(), print_pdf(), section_pages()

### Community 20 - "react"
Cohesion: 0.22
Nodes (7): Result, TokenPage(), LockScreen(), PurpleButton(), PurpleButtonProps, PageTitle(), react

### Community 21 - "build.mjs"
Cohesion: 0.13
Nodes (11): CARDS, css, here, out, postcss, repo, req, { rolldown } (+3 more)

### Community 22 - "tokenStore.ts"
Cohesion: 0.26
Nodes (7): POST(), restartGencloud(), FILE, genesysToken(), saveGenesysToken(), stored(), validAdminSecret()

### Community 23 - "push.ts"
Cohesion: 0.21
Nodes (11): alertsFor(), CalloutToast, NUDGE, TOASTS, Entry, g, PUSH_HOSTS, pushBatch() (+3 more)

### Community 24 - "RuleRow.tsx"
Cohesion: 0.18
Nodes (11): Props, ROUTE_OPTIONS, RuleRow(), SEVERITIES, Toggle(), Props, SelectGroup, SelectOption (+3 more)

### Community 25 - "client/alerts.ts"
Cohesion: 0.33
Nodes (10): alertTag(), alertWhileHidden(), base64Url(), clearAlert(), listeners, pauseAlerts(), subscribe(), syncAlerts() (+2 more)

### Community 26 - "demo.ts"
Cohesion: 0.20
Nodes (7): Incident, agents, demo, incidents, ledger, nudge, org

### Community 27 - "ContextBar.tsx"
Cohesion: 0.50
Nodes (7): BellIcon(), ContextBar(), useFeedDown(), useFeedPill(), enableAlerts(), useAlertState(), clock()

### Community 28 - "check.mjs"
Cohesion: 0.25
Nodes (4): cards, dir, here, out

### Community 29 - "list-queues.mjs"
Cohesion: 0.25
Nodes (6): env, get(), headers, queues, rows, watched

### Community 30 - "client/store.ts"
Cohesion: 0.48
Nodes (5): devOn(), apply(), connect(), disconnect(), mergeLedger()

### Community 31 - "sw.js"
Cohesion: 0.47
Nodes (5): CALLOUT_ACTIONS, NUDGE_ACTIONS, show(), showUnlessOnScreen(), windows()

## Knowledge Gaps
- **285 isolated node(s):** `Flag`, `Listener`, `DashboardSnapshot`, `SnapshotCallout`, `SnapshotIncident` (+280 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 353 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `react` to `jsx-runtime.js`, `rules.ts`, `next-image.tsx`, `index.d.ts`, `package.json`, `CsvImportDialog.tsx`, `DevBar.tsx`, `ledger/page.tsx`, `useConsole`, `dashboards/page.tsx`, `shims/store.ts`, `RuleRow.tsx`, `client/alerts.ts`?**
  _High betweenness centrality (0.131) - this node is a cross-community bridge._
- **Why does `vitest` connect `queueMap.ts` to `engine.ts`, `rules.ts`, `.subscribe`, `SimFeed.ts`, `package.json`, `floor.ts`, `gate.ts`, `tokenStore.ts`, `push.ts`, `check.mjs`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Why does `next` connect `gate.ts` to `runtime.ts`, `package.json`, `useConsole`, `dashboards/page.tsx`, `react`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **What connects `Flag`, `Listener`, `DashboardSnapshot` to the rest of the system?**
  _285 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `runtime.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0630673674151935 - nodes in this community are weakly interconnected._
- **Should `engine.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05286006128702758 - nodes in this community are weakly interconnected._
- **Should `rules.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05600722673893405 - nodes in this community are weakly interconnected._