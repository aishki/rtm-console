# RTM Console

Real-time monitoring and escalation for the live floor. Agent states flow from the Gencloud/NiceIEX feed through a configurable rules engine, and breaches climb a ladder: **Nudge (agent) → Leader (TL) → Ops (Ops + Manager, with an incident number)**. Five role views (Admin/WFM, Senior Leader, Manager, Team Lead/AM, Agent) scope every number to the viewer's span.

Next.js (App Router) + React + TypeScript, styled with the BITS Design System tokens.

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
| `NEXT_PUBLIC_FEED=sim` | Use the floor simulator. Dev only: it is ignored when `NODE_ENV=production`. Any other value uses the Gencloud adapter. |
| `NEXT_PUBLIC_VIEW_AS=1` | Dev/admin flag for the "View as" role selector. Without it every API route answers 401 until SSO is wired in `lib/server/session.ts`. |
| `GENCLOUD_API_BASE`, `GENCLOUD_CLIENT_ID`, `GENCLOUD_CLIENT_SECRET` | Read by the Gencloud adapter (still a stub). |

### Logos

The brand logo PNGs are not in the repository. Copy `carelon-global-solutions.png`, `opssup-logo.png`, `bits-logo.png` and `carelon-icon-mark.png` from the design handoff (`design/assets/logos`) into `public/assets/logos/`.

## Layout

```
app/
  (console)/layout.tsx            Navbar, context bar, footer, toast stack, nudge host
  (console)/{console,my-view,dashboards,rules,ledger}/page.tsx
  api/stream                      SSE: scoped snapshot on connect, then a delta every second
  api/session                     Dev "View as" (role and person)
  api/rules                       GET / PATCH rule configuration
  api/instances/[n]/ack, ack-all, [n]/comment
  api/incidents/[inc]             start / close with disposition
  api/export/{ledger,incidents}   CSV
  api/replay                      POST a CSV to start a replay, DELETE to exit
lib/
  engine/rules.ts                 Rule definitions, agent tests, evaluate, my targets
  engine/escalation.ts            fire(), strikes, the 3× rule, openIncident()
  engine/scope.ts                 PERMS, span scoping, who may acknowledge or comment
  engine/engine.ts                Clock, timers, feed ingestion, actions
  feed/FeedSource.ts              The adapter interface
  feed/GencloudFeed.ts            Production adapter (stub)
  feed/SimFeed.ts                 Dev-only simulator
  feed/CsvReplayFeed.ts           Historical replay at 60×
  csv/parse.ts, csv/export.ts     CSV import and exports
  server/                         Runtime registry, session, route guard, stream snapshots
  client/                         Zustand store fed by the stream, API client
components/                       ui/, chrome/, console/, rules/
```

## How it works

- **The engine runs on the server.** One live runtime serves the whole floor. A feed pushes agent states, queue metrics and heartbeats into the engine; the engine owns the shift clock, state timers, strikes, ledger and incidents, and evaluates every rule once a second.
- **The browser only renders.** It holds a store fed by `/api/stream` and sends mutations to the API. Every route resolves the caller's role and span and checks `PERMS` before acting, and everything sent to a browser is already scoped to that viewer.
- **A replay is private to the session that started it.** It gets its own engine, so reviewing a past day never disturbs the live floor. It shares the live rule configuration.
- **State is in memory.** Run this as a single long-lived Node process. It will not work on serverless hosting as is, and a restart clears the shift.

## Business rules

The engine is a port of the design prototype's `rtm-engine.js` and is covered by `lib/engine/engine.test.ts`: strike counting, the 3× rule, capped routes, re-arm logic and scoping.

One deliberate difference from the prototype: **Adherence breach and Transfer rate fire once per shift.** The written spec says they never re-arm, but the prototype cleared their fired flag on every state change, so an agent below target collected a new strike on each call. This build follows the written rule.

## Still to do

- `GencloudFeed` is a stub. Until it is implemented, a non-sim build shows "Gencloud not responding".
- SSO: replace `readSession` in `lib/server/session.ts`, then drop `NEXT_PUBLIC_VIEW_AS`.
- "Open incident draft" only shows a toast; wire it to the incident-report form.
- Elevance Sans font files are not in the design system yet, so the system UI font renders in its place.
- Persistence for rules, ledger and incidents.
