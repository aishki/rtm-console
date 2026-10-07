# RTM Console

Real-time monitoring and escalation for the live floor. Agent states flow from the Gencloud/NiceIEX feed through a configurable rules engine, and breaches climb a ladder: **Nudge (agent) → Leader (TL) → Ops (Ops + Manager, with an incident number)**. Five role views (Admin/WFM, Senior Leader, Manager, Team Lead/AM, Agent) scope every number to the viewer's span.

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4, styled with the BITS Design System tokens.

This README is the developer handoff. It covers what is built, what is stubbed, and where each remaining piece of work plugs in.

## Status

| Area | State |
| --- | --- |
| Rules engine, escalation, scoping, permissions | Done, unit tested |
| Five screens, layout chrome, CSV replay dialog | Done, checked against the design reference |
| API routes with server-side permission checks | Done |
| Floor data import (Excel template or CSV, 60× replay) | Done |
| Floor simulator | Done, dev and production |
| **Gencloud/NiceIEX feed adapter** | **Implemented (v1).** Live: agent presence/routing and queue metrics. See [Backend work 1](#1-gencloud-feed-adapter) for env and run instructions. |
| **SSO (role and span from the session)** | **Not wired.** See [Backend work 2](#2-sso) |
| **Persistence** | **None, all state is in memory.** See [Backend work 3](#3-persistence) |
| Incident-report form ("Open incident draft") | Stub, shows a toast only |
| Elevance Sans font | Files not supplied; system UI font renders instead |

## Run it

```bash
npm install
cp .env.example .env.local
npm run dev        # http://localhost:3000
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Engine unit tests (Vitest) |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |

### Environment

| Variable | Meaning |
| --- | --- |
| `NEXT_PUBLIC_FEED=sim` | Start on the floor simulator. Set to a non-"sim" value (e.g., `gencloud`) to start on the Gencloud adapter. An admin can switch between the two while the server runs (see "Switching the data source"). |
| `NEXT_PUBLIC_VIEW_AS=1` | Dev/admin flag for the "View as" role selector. **Without it every API route answers 401**, because no SSO exists yet. Required for Gencloud development. |
| `GENESYS_TOKEN` | Hand-grabbed supervisor bearer token from the browser DevTools Network tab (Authorization header of an api.mypurecloud.com request). Short-lived. Seeds the first start only: a token pasted on `/admin/token` replaces it (see "Refreshing the Genesys token"). |
| `RTM_ADMIN_SECRET` | Secret for `/admin/token`. While unset, the page refuses every request. |
| `RTM_SITE_PASSWORD` | Password for the wall in front of the whole console (see "Password wall"). **While unset, nobody can get in.** Quote it in `.env.local`: an unquoted `#` starts a comment. |
| `GENCLOUD_API_BASE` | Gencloud API base URL, e.g. `https://api.mypurecloud.com`. |
| `RTM_VIEW_CONFIG_ID` | Saved "CSBDProviderData" view ID (default: `9c9f8fd2-acab-4282-9442-ddba152f9c18`, the 89-queue voice-floor view). |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Key pair for desktop alerts over Web Push. Generate with `npx web-push generate-vapid-keys`. Optional: without them, alerts only show while a console tab is open. |
| `VAPID_SUBJECT` | Contact for the push services, `mailto:` or `https:` (optional). |

`.env*` files are gitignored except `.env.example`.

### Logos

The brand logo PNGs are in `public/assets/logos/`: `carelon-global-solutions.png` (navbar), `bits-logo.png` (footer) and `carelon-icon-mark.png` (nudge). The originals are in the design handoff (`design/assets/logos`).

### What you see in each mode

- **Dev with `NEXT_PUBLIC_FEED=sim`:** 199 simulated agents in 10 teams, starting at 08:15 with 15 minutes of history, random repeat offenders, and one 44-second feed outage four minutes in.
- **Dev/prod with `NEXT_PUBLIC_FEED=gencloud` and valid `GENESYS_TOKEN`:** live agents and queues from the watched view (presence/routing state and queue metrics). Bootstrap failure or an expired token keeps the feed silent until a fresh token is pasted on `/admin/token` or the server restarts.

### Switching the data source

An Admin sees a **Data** selector in the context bar: **Live Genesys** or **Simulation**. `NEXT_PUBLIC_FEED` only decides which one the server starts on.

- The switch is for everyone: there is one floor, and every open console follows it without reloading. The feed pill says which one is on screen.
- **The simulation uses real names.** Its floor keeps the simulator's shape (ten teams of 15 to 25 agents) but takes the ten largest teams of the Gencloud roster and the first agents of each. Team leads, managers and LOBs are not in the Gencloud roster, so the sample ones stay. Everything that happens on that floor (states, call-outs, incidents) is invented.
- The names come from the running Gencloud floor. Each roster Gencloud delivers is also saved to `.rtm/roster.json`, so the simulation can still use real names when the token has expired. Without either, the sample teams and names are used and the pill reads "Simulation · sample floor". `.rtm/` is gitignored: it holds real people's names.
- Gencloud keeps running behind a simulation, so its ledger and strikes are there on the way back. A simulation starts fresh every time it is switched on.
- Desktop alerts follow the floor on screen, so a simulation does raise them. In a production build that means real people can get desktop alerts for invented call-outs while a simulation is on.

### Password wall

Every page and API route sits behind one shared password, `RTM_SITE_PASSWORD`. `/` is the lock screen; a browser that has not unlocked is sent there from any page (and returned to that page afterwards), and API calls answer 401.

- The server checks the password and sets an httpOnly cookie for 12 hours. The cookie holds an HMAC keyed by the password, not the password, so changing the password locks every browser out.
- Ten wrong guesses from one address lock it out for 15 minutes. The address comes from `X-Forwarded-For`, which a caller can fake, so 30 wrong guesses in total also pause every unlock attempt for 15 minutes. Browsers already unlocked are not affected.
- Static files the lock screen needs (`/_next/static`, `/assets`, `/sw.js`) stay reachable. Everything else goes through `proxy.ts`.
- This is a shared-password wall, not sign-in: it says nothing about who someone is. Roles still come from "View as" until SSO replaces both.

### Refreshing the Genesys token

The hand-grabbed token expires after about 8 hours. To replace it without restarting the server, open `/admin/token`; an Admin also gets a **Refresh token** link in the feed pill while Gencloud is not responding.

- Paste the admin secret (`RTM_ADMIN_SECRET`) and the new bearer token. A leading `Bearer ` is stripped.
- The server checks the token against Genesys (`/api/v2/users/me`) and refuses one Genesys rejects.
- An accepted token is saved to `.rtm/genesys-token` (gitignored) and wins over `GENESYS_TOKEN` from then on, including after a restart.
- The Gencloud feed reconnects with it. The floor, ledger, incidents and strikes are kept: a roster resent mid-shift carries each known agent's strikes and shift counters over.
- The page is guarded by the secret, not the session, because "View as" lets anyone act as Admin until SSO exists.

## Saving a dashboard snapshot

Everyone with the Dashboards tab has **Dashboards → Save snapshot**. It downloads one HTML file holding the call-outs, incidents and teams of that person's span at that moment. The file opens offline; its filters (manager, team, rule, agent, stage, incident status), sortable tables and clickable bars work, and it has no way to write back to the console. It names its data source, and says so when the activity is simulated or replayed.

The file holds agent names and leaves the console's access control once saved, so treat it like an export.

## Importing floor data

Admins and Managers can replay a day of their own data instead of the simulator: **Dashboards → Import floor data**.

The button is only there while the floor is on the simulation (or inside a replay). On the live Genesys feed it is hidden, and `POST /replay` and `POST /import/validate` answer 403.

1. **Download template** gives `RTM_floor_data_template.xlsx` (built on request by `lib/import/xlsx.ts`). It has instructions and a sample day, so it runs as downloaded.
2. Fill it in and upload it. The file is checked first and the dialog lists every problem, or a summary and any warnings.
3. **Start replay** runs the day through the rules engine at 60× (a nine-hour shift takes about nine minutes). Only the session that started it sees it; **Exit replay** returns to the live floor.

| Sheet | Required | Columns | Unlocks |
| --- | --- | --- | --- |
| Roster | Yes | Agent Name, Team, Team Lead, Manager, LOB\*, Adherence %\* | Agent grid, role scoping, My View |
| Agent Status | Yes | Agent Name, Status, Start Time, Transferred\* | State timers, strikes, nudges, incidents, Short call, Transfer rate |
| Holds | No | Agent Name, Hold Start, Hold End | Long hold |
| Queue Intervals | No | Interval Start, Calls Waiting\*, Service Level %\*, ASA (s)\*, Abandon %\* | Queue tiles and the three queue rules |

\* optional column. One file is one shift. Times are used exactly as written, with no timezone conversion. Statuses can be the seven console states or Genesys names ("On Queue", "After Call Work", "Meal"), which are mapped by `guessState()`. The Queue Intervals sheet accepts the all-queues totals from a Genesys queue performance export, including its 0–1 fractions.

A raw Gencloud agent-status CSV still works in the same dialog, with column and status mapping, but it carries statuses only: no org, holds or queue data.

Validation and the sheet contract live in `lib/import/floor.ts` (pure, tested in `floor.test.ts`).

## Architecture

```
 Gencloud / NiceIEX ──► FeedSource ──► Engine (server, in memory) ──► /api/stream (SSE) ──► Zustand store ──► React screens
   (or SimFeed, CsvReplayFeed)             ▲                                                                        │
                                           └────────── /api/* mutations (PERMS checked) ◄───────────────────────────┘
```

- **The engine runs on the server.** One live runtime serves the whole floor. A feed pushes agent states, queue metrics and heartbeats in; the engine owns the shift clock, state timers, strikes, ledger and incidents, and evaluates every rule once a second.
- **The browser only renders.** It holds a store fed by the stream and sends mutations to the API. Nothing is computed client-side that affects business state.
- **Everything is scoped on the server.** Each route resolves the caller's role and span, checks `PERMS`, and only returns data inside that span.
- **A replay is private to the session that started it.** It gets its own engine, so reviewing a past day never disturbs the live floor. It shares the live rule configuration.

### Layout

```
app/
  (console)/layout.tsx            Navbar, context bar, footer, toast stack, nudge host
  (console)/{console,my-view,dashboards,rules,ledger}/page.tsx
  api/                            Route handlers (see API reference)
lib/
  types.ts                        Shared types, including the stream message shapes
  engine/rules.ts                 Rule definitions, agent tests, evaluate, my targets
  engine/escalation.ts            fire(), strikes, the 3× rule, openIncident()
  engine/scope.ts                 PERMS, span scoping, who may acknowledge or comment
  engine/engine.ts                Clock, timers, feed ingestion, actions
  engine/engine.test.ts           Unit tests
  feed/FeedSource.ts              The adapter interface
  feed/GencloudFeed.ts            Production adapter (stub)
  feed/SimFeed.ts                 Floor simulator
  feed/CsvReplayFeed.ts           Historical replay at 60× (CSV or imported workbook)
  import/floor.ts                 Template contract and validation
  import/xlsx.ts                  Reads uploads, builds the template (exceljs)
  csv/parse.ts, csv/export.ts     CSV import and exports
  server/runtime.ts               Engine + feed + 1s timer; live and per-session replay registry
  server/session.ts               Who is calling (cookies today, SSO later)
  server/guard.ts                 authorize() / authorizeFor(flag) used by every route
  server/snapshot.ts              Builds the scoped stream messages
  client/store.ts                 Zustand store and the EventSource connection
  client/api.ts                   Fetch wrappers for every mutation
  ui/palette.ts                   Status colors and the tab list
components/
  ui/                             Buttons, FilterChip, LogoLockup, DataTable, KpiTile, Toggle, StatusPill
  chrome/                         ConsoleShell, Navbar, ContextBar, ToastStack, NudgePopup, CsvImportDialog
  console/                        AgentCard, TeamGroup, AgentGridToolbar, TriggerCard (+ Ladder), IncidentTiles
  rules/                          RuleRow
```

`lib/engine`, `lib/csv` and `lib/types.ts` have no server or browser dependencies and are imported by both sides.

## Backend work

### 1. Gencloud feed adapter

Implemented in `lib/feed/GencloudFeed.ts`. It establishes a WebSocket connection to Gencloud Notifications API and ingests agent presence/routing state and queue metrics.

#### Run instructions

1. **Environment:**
   - `NEXT_PUBLIC_FEED=gencloud` (or any non-"sim" value; dev default is "sim")
   - `NEXT_PUBLIC_VIEW_AS=1` (required for admin access without SSO)
   - `GENESYS_TOKEN`: hand-grabbed supervisor bearer token from the browser DevTools Network tab. Grab it from the Authorization header of any api.mypurecloud.com request. Short-lived (typically 8 hours). On bootstrap failure (e.g., expired token), the feed stays silent; paste a fresh token on `/admin/token`.
   - `GENCLOUD_API_BASE`: e.g., `https://api.mypurecloud.com`
   - `RTM_VIEW_CONFIG_ID`: saved "CSBDProviderData" view ID (default: `9c9f8fd2-acab-4282-9442-ddba152f9c18` for the 89-queue voice-floor view)

2. **Start the dev server:**
   ```bash
   npm run dev        # http://localhost:3000
   # Or choose a port:
   npm run dev -- -p 3001
   ```

3. **What you see:** Live agents and queues from the watched view. Agent presence/routing state (Avail, On Call, ACW, aux modes, Offline) and queue metrics (calls in queue, service level, ASA, abandon %) update in real time.

#### V1 scope and gaps

**Live now:**
- Agent presence/routing state (triggers ACW, Aux, Offline, Long Call, and related escalation rules)
- Queue metrics: calls in queue, service level %, ASA seconds, abandon % (trigger queue rules and feed-stale detection)

**Not yet live (depend on conversation-level topics and WFM adherence API — later tasks):**
- Call release detection (`callEnded`), so AHT, Short Call, Transfer, and Hold Duration rules remain quiet
- Shift adherence tracking

**Org model (v1 simplification):**
- One team per queue. Team Lead and Manager cells show blank; real org hierarchy is a later mapping task.

**Authentication (v1 simplified):**
- Hand-grabbed short-lived bearer token. Production OAuth (client credentials) is a later task.

### 2. SSO

Identity today is two cookies set by the dev "View as" selector: `rtm_sid` (random session ID) and `rtm_view` (`role:person`). Both are httpOnly, SameSite=Lax. This is a development convenience and anyone can pick any role.

To wire SSO, replace the body of `readSession()` in `lib/server/session.ts` so it returns `{ sid, view: { role, who } }` for the signed-in user, or `null` when nobody is signed in. Everything downstream (`authorize()`, scoping, the stream) already depends only on that return value.

- `role` is one of `admin | senior | mgr | tl | agent`.
- `who` must equal the person's name **as it appears in the roster**: the TL name on `Team.tl`, the manager name on `Team.mgr`, or the agent name. `resolveView()` snaps an unknown name onto the first person for that role, which is right for the dev selector and wrong for production: make it reject instead once SSO is in.
- Then turn off `NEXT_PUBLIC_VIEW_AS`. `POST /api/session` already refuses when it is off, and the selector disappears because the stream stops sending the people directory.
- There is no CSRF protection beyond SameSite=Lax and no rate limiting. Add both with real auth.

### 3. Persistence

All state lives in one object per engine (`EngineState` in `lib/engine/escalation.ts`): rules, ledger, incidents, agents with their strikes. A restart clears the shift and resets rules to defaults.

- Run it as **one long-lived Node process**. Serverless or multi-instance hosting will not work as is: each instance would run its own engine.
- Every state change goes through a small set of functions, which are the places to add writes: `fire()` and `openIncident()` in `escalation.ts`, and `ack`, `ackAll`, `comment`, `invAction`, `setThr`, `setSev`, `setRoute`, `setOn` in `engine.ts`.
- Rules are the first thing worth persisting. They are a single shared array created in the registry in `runtime.ts` (`defaultRules()`); load them from storage there.
- To scale out, keep one engine process and fan the stream out through a broker, or move engine state to a shared store.

### 4. Smaller items

- **Incident draft:** `onDraft` in `app/(console)/console/page.tsx` only shows a toast. Wire it to the incident-report form.
- **Replay runtimes** are capped at 8 at once (oldest evicted) and otherwise live until the user exits. Add an idle timeout if that matters.
- **Upload limit** is 10 MB (`lib/server/upload.ts`).

## API reference

All routes are under `/api`. Errors are `{ "error": string }`. Every route answers **401** until the browser has passed the password wall, and also when there is no session; **403** when the role lacks the permission.

| Route | Who | Request | Response |
| --- | --- | --- | --- |
| `GET /session` | anyone | | `{ view, viewAs }` |
| `POST /session` | anyone, dev flag only | `{ role, who? }` | `{ view }`. 400 unknown role. |
| `GET /session/states` | anyone, dev flag only | | `{ states }`: every agent's current state by name, for the "View as" person search. Not scoped. |
| `GET /stream` | anyone | | Server-sent events, see below |
| `GET /rules` | roles with the Rules tab | | `{ rules, canEdit }` |
| `PATCH /rules` | `rulesEdit` | `{ id, thr?, sev?, route?, on? }` | `{ rule }`. 404 unknown rule, 400 invalid value. |
| `POST /instances/:n/ack` | Console roles in span; an agent for their own | | `{ instance }`. 404 if outside the span. |
| `POST /instances/ack-all` | `ackAll` | | `{ count }` |
| `POST /instances/:n/comment` | the agent it belongs to | `{ text, ack? }`, text 1–140 chars | `{ instance }` |
| `POST /incidents/:inc` | `invAct`, in span | `{ action: "start" }`, `{ action: "reopen" }` (back to Open), `{ action: "record", disposition }` or `{ action: "close" }` | `{ incident }`. 409 wrong status, or closing with no disposition recorded. |
| `GET /export/ledger` | `export` | | `RTM_instance_ledger.csv` |
| `GET /export/incidents` | `export` | | `RTM_investigation_register.csv` |
| `GET /export/snapshot` | roles with the Dashboards tab | | `RTM_dashboard_snapshot_<date>_<time>.html`: the caller's Dashboards screen as one read-only file with working filters (`lib/snapshot/dashboard.ts`) |
| `GET /import/template` | `replay` | | `RTM_floor_data_template.xlsx` |
| `POST /import/validate` | `replay`, not on the live Genesys feed | multipart: `file` (.xlsx) | `{ summary, warnings }`, or 400 `{ error, errors[] }` |
| `POST /feed` | `feed` | `{ source: "gencloud" \| "sim" }` | `{ feed, realNames }`. Switches the floor for everyone. |
| `POST /unlock` | anyone (the only route open before unlocking) | `{ password, next? }` | `{ ok, next }` and the unlock cookie. 401 wrong password, 429 after ten wrong guesses, 503 if `RTM_SITE_PASSWORD` is unset. |
| `POST /admin/token` | holder of `RTM_ADMIN_SECRET` (no session needed) | `{ secret, token }` | `{ ok, who }`. 401 wrong secret, 400 empty or rejected token, 502 Genesys unreachable. Saves the token and reconnects the Gencloud feed. |
| `POST /replay` | `replay`, not on the live Genesys feed | multipart: `file` (.xlsx template, or .csv with `cols?`, `smap?` JSON strings) | `{ view, replay }`. 400 `{ error, errors[] }`, 413 over 10 MB. |
| `DELETE /replay` | `replay` | | `{ ok: true }` |
| `GET /push` | anyone | | `{ key }`, the public key to subscribe with, or `null` when push is not configured |
| `POST /push` | anyone | `{ subscription }` (the browser's `PushSubscription`) | `{ ok: true }`. 400 if not a known push service, 503 if not configured. |
| `DELETE /push` | anyone | `{ endpoint }` | `{ ok: true }` |

Instances outside the caller's span return 404, not 403, so their existence is not revealed.

### Stream

`GET /api/stream` sends `data: <json>\n\n` frames. Types are `InitMsg` and `TickMsg` in `lib/types.ts`.

- The first frame is `type: "init"`: the viewer, the teams in span, the whole scoped ledger, and (dev flag only) the people directory for the selector.
- Then one `type: "tick"` per engine second, plus one immediately after any mutation. Each carries the clock, feed status, queue, rules, all agents in span, all incidents in span, **only the ledger rows that changed** (matched by `n`), and any toasts and nudges for this viewer.
- A dropped connection reconnects by itself and gets a fresh `init`.
- The client must reconnect after the role, person or replay state changes; `lib/client/api.ts` does this.
- Toasts for call-outs go only to leaders with that call-out in span. An agent only receives their own nudges, Senior Leader receives none, and none are sent during a replay.

### Desktop alerts

Whatever the console pops up for a person is also raised as a system notification: nudges for the agent, and for leaders the nudge previews and call-out toasts of their span, so they are seen when the console is not on screen. "Enable desktop alerts" in the context bar asks for the browser permission once per browser.

- **Web Push** (`lib/server/push.ts`, `public/sw.js`): the live runtime pushes each nudge and call-out to the subscriptions of the people it is in scope for. This works with the browser minimized, and with it closed where the browser still receives push (Edge on Windows; Chrome while it runs in the background). Pushes expire after 60 seconds so a stale nudge never appears later.
- **Hidden-tab fallback** (`lib/client/alerts.ts`): an open but hidden tab raises the same notification from the stream, for networks that block the push services. Both use the tag `rtm-<n>`, so each call-out shows once.
- The alert carries the same wording as the in-page nudge or toast; a leader's alert adds the team on a second line. Windows draws the notification itself, so its layout and colours cannot follow the console's.
- "Got it" and "Acknowledge" act without opening the console. A nudge has "Got it" (acknowledges) and "Send reason", which brings the console forward with that nudge's pop-up and the cursor in its reason box (Chrome on Windows does not let anyone type inside a notification). A leader's alert has "Acknowledge" and "Open console". Browsers allow two buttons, so "On a case, 2 min" is left out: closing the notification does the same.
- Allowing desktop alerts never replaces the in-page ones. An agent's unacknowledged nudge is shown again when they open the console, and a toast's 8 seconds only count while the tab is on screen.
- Needs HTTPS (localhost is exempt). Subscriptions are kept in memory and tied to the "View as" person until the database and SSO exist; see the `TODO`s in `lib/server/push.ts`.
- Replays never raise desktop alerts.

### Permissions

`PERMS` in `lib/engine/scope.ts` is the single source. The UI hides what a role cannot do and the API enforces it.

| Role | Tabs | Scope | Rules edit | Investigations | Exports | Ack all | Incident tiles | Replay | Data source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Admin (WFM) | Console, Dashboards, Rules, Ledger | All teams | yes | yes | yes | yes | yes | yes | yes |
| Senior Leader | Dashboards | All teams | no | no | no | no | no | no | no |
| Manager | Console, Dashboards, Rules, Ledger | Their teams | yes | yes | yes | no | yes | yes | no |
| Team Lead / AM | Console, Dashboards, Ledger | Their team | no | no | no | no | no | no | no |
| Agent | My View | Self | no | no | no | no | no | no | no |

Queue and floor call-outs are visible to every leader role and never to agents.

## Business rules

The engine is a TypeScript port of the design prototype's `rtm-engine.js`.

- **Rule types:** duration (state timer), event (per occurrence: short call), ratio (transfer rate, needs 5 calls), queue (floor metrics), system (feed heartbeat). The 14 defaults are in `defaultRules()`.
- **Duration rules fire once per state episode** and re-arm when the state changes or the value drops back under the threshold. Offline agents are evaluated only by Prolonged offline.
- **Strikes** count per agent, per rule, per shift. Full ladders (`nudge`, `lead`): strike 2 reaches the TL, strike 3 and later reach Ops and open or update incident `INC-2026-NNNN`. At most one open incident per agent per rule. Capped routes (`nudgeonly`, `leadonly`) never climb and never open incidents.
- **Queue and system rules** fire once per breach, re-arm on recovery, and are logged against "Queue" / "Floor".
- **Time** is seconds since midnight everywhere (`t`, `ackT`, `closedT`).

### Where this build differs from the prototype

- **Adherence breach and Transfer rate fire once per shift.** The written spec says they never re-arm, but the prototype cleared their fired flag on every state change, so an agent below target collected a new strike on each call. This build follows the written rule and therefore opens far fewer incidents than the prototype.
- **Senior Leader has no Rules tab.** The design README says "read-only for Senior" but `PERMS` and the feature inventory give Senior dashboards only. This build follows `PERMS`. The read-only rendering of the Rules page exists and works if that changes.
- **Replay is per session**, not a replacement of the whole floor.
- **Queue rules run during a replay when the import has queue data.** The prototype always switched them off.
- **Only the agent can attach a reason.** In a leader's nudge preview, "Send reason" with text saves nothing.
- **A call ends only when the feed says so** (`callEnded`), not on any transition out of On Call.

## Frontend notes

- **State:** live data is in the Zustand store (`useConsole`). Filters, expanded teams, drafts and dialog state are local `useState` and reset when you leave the screen.
- **Route guard:** `ConsoleShell` redirects to the first allowed tab when the role cannot open the current one. This is a convenience; the API is the actual boundary.
- **Tokens:** BITS tokens are CSS variables in `app/globals.css`, mapped into the Tailwind theme in the `@theme` block (`text-purple`, `bg-tint`, `rounded-15`, `ring-card`, `num`, and so on). Colors chosen at runtime from engine data are in `lib/ui/palette.ts`.
- **Breakpoints:** `w560`, `sm` (640), `w720`, `w900`, `xl` (1280) drive the navbar's responsive behavior.
- **Line height:** Tailwind's default line heights on `text-xs` to `text-lg` are overridden to `normal` to match the design. Set `leading-*` explicitly where needed.
- **Design rules:** no shadows except toasts and the nudge, no gradients, no entrance animations, sentence case except nav tabs, no emoji.
- **Font:** when the Elevance Sans files arrive, add the `@font-face` to `globals.css`; `--bits-font-brand` already lists it first.
- **Next.js 16:** `AGENTS.md` asks you to check `node_modules/next/dist/docs/` before relying on older conventions. Route `params` are Promises and `cookies()` is async.

## Tests

`npm test` runs the unit tests. `lib/engine/engine.test.ts` covers strike counting, the 3× rule, capped routes, re-arm logic, feed staleness, scoping, the permission table, acknowledge and comment. `lib/import/floor.test.ts` covers the import validation and runs the downloadable template through the engine end to end.

Tests drive the engine through the same `ingest` handlers a feed uses, one `tick()` per second, so they are also the best reference for how a feed adapter should behave. There are no API route or component tests yet.
