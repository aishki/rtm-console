# RTM Console · Backlog

Everything still open as of **7 October 2026**. Items 19 and 20 are built and need follow-ups; nothing else on this list has been started.

Related: [README](../README.md) (code layout, API reference, backend task list) · [Data architecture](data-architecture.md) (data model, database options, open decisions) · [Simulation Guide](RTM_Console_Simulation_Guide.pdf).

## Where things stand

- **Built and merged to `main`:** the five screens and layout chrome, the rules engine (server-side), ten permission-checked API routes, the floor simulator (dev and production builds), CSV replay, and the floor data import from an Excel template.
- **Tests:** 65 unit tests (`npm test`) covering the engine, the import, the Gencloud adapter, desktop alerts and the simulator's seeding. Typecheck, lint and production build pass.
- **Pull requests merged:** #1 floor data import, #2 simulation guide, #3 data architecture document.
- **Built on `feat/feed-switch` (7 Oct 2026):** desktop alerts, and the switch between the live Gencloud feed and a simulation with real names.
- **Not built:** sign-in, any form of storage, and the parts of the Gencloud feed that need conversation and adherence data.

## 1. Blocks going live

| # | Item | Notes | Where in the code |
| --- | --- | --- | --- |
| 1 | **Gencloud feed adapter** | A stub today. Needs the Genesys access decisions first (sign-in type, topics, limits) | `lib/feed/GencloudFeed.ts`, constructed in `createLive()` in `lib/server/runtime.ts` |
| 2 | **SSO sign-in** | Anyone can pick any role with the "View as" selector. Also add CSRF protection and rate limiting. Once in, make an unknown person a rejection instead of snapping to the first person for the role | `readSession()` in `lib/server/session.ts`; `resolveView()` in `lib/engine/scope.ts` |
| 3 | **Database** | Nothing is saved; a restart wipes the shift and resets rules. Waiting on the PostgreSQL / MongoDB decision (PostgreSQL recommended) | Write points: `fire()` and `openIncident()` in `lib/engine/escalation.ts`; `ack`, `ackAll`, `comment`, `invAction`, `setThr`, `setSev`, `setRoute`, `setOn` in `lib/engine/engine.ts` |
| 4 | **Real IDs instead of names** | Agents, teams and rules are linked by name. Breaks on duplicate names or renames. Genesys user ID is the natural agent key | `lib/types.ts` and throughout the engine |
| 5 | **Shift start and end** | No rollover exists. Strikes and the ledger accumulate until restart. Times are seconds since midnight with no date | `engine.reset({ t })`; `createLive()` |
| 6 | **Org structure source** | Where Team → Team Lead → Manager → LOB comes from is unconfirmed | Feed adapter `onRoster` |

## 2. Product gaps

| # | Item | Notes |
| --- | --- | --- |
| 7 | **Incident-report form** | "Open incident draft" only shows a toast (`onDraft` in `app/(console)/console/page.tsx`) |
| 8 | **Replay speed** | Fixed at 60×, so a nine-hour shift takes nine minutes. Proposed: an instant mode as the default plus a speed selector. **Awaiting a yes or no** (`REPLAY_SPEED` in `lib/feed/CsvReplayFeed.ts`) |
| 9 | **Adherence** | Estimated from time in status (`deriveAdh`). Real values need NiceIEX |
| 10 | **Calls waiting** | Not in Genesys interval exports, so the Queue backlog rule cannot fire on imported data |
| 11 | **One floor or several queues** | The console shows one set of queue numbers; the October export has 48 queues |
| 12 | **Status mapping table** | Genesys statuses are guessed by name (`guessState()` in `lib/csv/parse.ts`). Should be an agreed, editable list |
| 13 | **Elevance Sans font** | Files were never supplied; the system font renders instead. Add the `@font-face` to `app/globals.css` when they arrive |
| 14 | **Logos in the repo** | Done in PR #5: the three logos the app uses are committed. `bits-logo.png` is 2.7 MB and could be replaced with a smaller export |

## 3. Engineering

| # | Item | Notes |
| --- | --- | --- |
| 15 | **Tests for API routes and screens** | Only the engine and the import are tested |
| 16 | **Running more than one server** | The engine lives in one process, so the app cannot be load-balanced as is. Options are in the data architecture document, Section 9 |
| 17 | **Replay cleanup** | Abandoned replays stay in memory until the user exits or eight others push them out (`MAX_REPLAYS` in `lib/server/runtime.ts`). Add an idle timeout |
| 20 | **Data source switch: follow-ups** | Built on branch `feat/feed-switch` (7 Oct 2026). An Admin can switch the floor between the Gencloud feed and a simulation that uses real team and agent names (README, "Switching the data source"). Open: exports and the ledger of a simulation are not marked as simulated; team leads and managers in a simulation are the sample ones because Gencloud has no org structure (item 6) |
| 19 | **Desktop alerts: production readiness** | Built on branch `feat/feed-switch` (7 Oct 2026). Seen working in Chrome on Windows with the console tab in the background; not yet tried with the browser fully closed, or in Edge. Subscriptions are in memory and tied to the "View as" person (`TODO`s in `lib/server/push.ts`). IT must confirm the firewall allows the Google and Microsoft push services, pre-grant the notification permission, and keep Chrome running in the background |
| 18 | **Unused `opssup-logo.png`** | Still in `public/assets/logos`, referenced by nothing since the navbar change |

## 4. Decisions waiting on someone

The full list of ten, with options, is in [data-architecture.md, Section 10](data-architecture.md#10-decisions-needed).

| Decision | Owner | Blocks |
| --- | --- | --- |
| Database: PostgreSQL (recommended) or MongoDB | Backend lead, BITS | Item 3 |
| Genesys access: OAuth grant, topics, current limits | Genesys administrator | Item 1 |
| Org structure source | WFM, Genesys administrator | Item 6 |
| What a shift is, and what happens at rollover | WFM, Operations | Item 5 |
| Adherence source | WFM | Item 9 |
| Agreed status mapping | WFM | Item 12 |
| One floor or one set of numbers per LOB | WFM, Operations | Item 11 |
| Keep raw status events, and retention periods | BITS, data governance | Item 3 sizing |
| SSO provider and role matching | IT, BITS | Item 2 |

## 5. Small open points

- **Simulation guide cover** credits "Arielle Jimera, UI/UX Designer / Developer · BITS Automation Team", and the FAQ says to contact the BITS Automation Team. Wording not yet confirmed.
- **Guide screens are drawn mock-ups**, not screenshots. Real screenshots are an option.
- **Genesys details in the data architecture document** (topic names, about 1,000 subscriptions per channel, about 24-hour channel lifetime) come from public documentation and are not yet confirmed against the tenant.
- **Data architecture diagrams** are Mermaid and have not been checked as rendered on GitHub.
- **Nudge pop-up** was verified by its rendered content, never by screenshot.
- **Import dialog**: starting a replay and the error list were exercised through the API and tests, not clicked through in the browser.

## 6. Suggested next steps

**Still to check on desktop alerts (item 19):**

1. Click "Got it", "Send reason" and "Acknowledge" on real notifications and confirm the instance changes in the ledger.
2. View as an agent, close the console, wait for a nudge, and confirm the pop-up is there when the console is opened again.
3. Close the browser completely and repeat in both Chrome and Edge. Chrome is expected to need its "continue running background apps" setting; Edge is expected to deliver through Windows.
4. Take the IT questions in item 19 forward.

The design and its limits are in the README under "Desktop alerts" and "Switching the data source".

Items **8** (replay speed), **7** (incident-report form) and **15** (more tests) need no outside decisions and can start now. Everything in Section 1 is waiting on a decision in Section 4.

## 7. Things to remember

- **The repository is public.** Never commit `GenCloudOverall/` (real exports with internal queue names and IDs), `design_handoff_rtm_console/`, or `docs/vrs-admin-manual.pdf`. All three are in `.gitignore`. The logos in `public/assets/logos/` are committed.
- **Three places this build deliberately differs from the design prototype:** Adherence breach and Transfer rate fire once per shift (the prototype re-fired them on every state change); Senior Leader has no Rules tab (follows `PERMS`); a replay is private to the session that started it.
- **Compact buttons are 32px** per the design README, although the prototype renders them at about 38px.
- **Commits** use Conventional Commits, authored as the repository owner with no co-author trailer. Work goes on a branch and through a pull request.
- **To rebuild the guide:** `python docs/build_pdf.py` (needs Chrome or Edge, and `pip install pypdf`). Edit `docs/src/simulation-guide.html`, not the PDF.
- **Local dev:** `npm run dev`, with `.env.local` copied from `.env.example` (`NEXT_PUBLIC_FEED=sim`, `NEXT_PUBLIC_VIEW_AS=1`).
