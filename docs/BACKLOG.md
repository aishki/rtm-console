# RTM Console · Backlog

Everything still open as of **10 November 2026**. Done items are listed at the end (Section 8) so their numbers stay stable.

Related: [README](../README.md) (code layout, API reference, backend task list) · [Data architecture](data-architecture.md) (data model, database options, open decisions) · [Simulation Guide](RTM_Console_Simulation_Guide.pdf).

## Where things stand

- **Live on CGSPH** (rtm.teamcgs.io), on `main` at b672e32 since 9 November 2026: the five screens, the rules engine, the live Genesys floor and PostgreSQL storage. All 24 tables are in production and filling from the live floor (checked in pgAdmin on 9 November).
- **Saved and carried over a restart:** rules and rule overrides, people, queues and the WFM mapping, shifts, call-outs, strikes, incidents (with owner, notes and closing note), desktop-alert subscriptions and deliveries, the audit trail, and today's raw Genesys events.
- **Tests:** 309 (285 unit, 24 PostgreSQL integration). Typecheck and lint pass.
- **On branch `feat/ui-multiselect-search` (not merged yet):** multi-pick LOB and queue filters on the agent grid; agent name or ID search on Agents with incident reports, the investigation register and the Instance Ledger; multi-pick queue filters on the register and the ledger, whose filters now sit in the table panel. AHT and adherence show **N/A** instead of the old 420s and 96% defaults, and an Offline agent with no calls today shows N/A for every number (items 9 and 30).
- **Pull requests merged:** up to #54. `main` is the only branch.
- **Not built:** sign-in (item 2, on hold), the incident-report form (item 7), history screens (item 28), and the Genesys parts that need conversation and adherence data (items 9 and 10).

## 1. Before a wider rollout

| # | Item | Notes | Where in the code |
| --- | --- | --- | --- |
| 1 | **Gencloud feed adapter** | No longer a stub: the live adapter is merged (PR #7), with real state mapping and service level (PR #16) and paced startup requests (PR #17). Still missing the parts that need conversation and adherence data (items 9 and 10). The Genesys access decisions (sign-in type, topics, limits) are still open | `lib/feed/GencloudFeed.ts`, constructed in `createLive()` in `lib/server/runtime.ts` |
| 2 | **SSO sign-in and roles (RBA)** | **On hold (9 Nov 2026).** Anyone can pick any role with the "View as" selector. **Plan (2026-11-09):** sign in with CGSAuth, which confirms identity only (Domain ID, name, manager's Domain ID; no roles). Match the Domain ID to `person.domain_id` to get the Genesys user. Work out the role from the reporting lines with the rules "View as" already uses (`peopleFor` in `lib/engine/scope.ts`): direct reports on the floor = Team Lead, above a Team Lead = Manager, else agent. Admin and Senior Leader come from an allowlist the console keeps. Screen permissions stay as `PERMS` has them. "View as" becomes admin and developer only. Caveats: about 35% of agents have no supervisor in Genesys; the chain above a Team Lead reaches directors; one Domain ID can be in several orgs; a role saved at sign-in lags the database until the next sign-in. Closes item 23. Also add CSRF protection and rate limiting. Once in, make an unknown person a rejection instead of snapping to the first person for the role | `readSession()` in `lib/server/session.ts`; `resolveView()` in `lib/engine/scope.ts` |

## 2. Product gaps

| # | Item | Notes |
| --- | --- | --- |
| 7 | **Incident-report form** | "Open incident draft" only shows a toast (`onDraft` in `app/(console)/console/page.tsx`) |
| 8 | **Replay speed** | Fixed at 60×, so a nine-hour shift takes nine minutes. Proposed: an instant mode as the default plus a speed selector. **Awaiting a yes or no** (`REPLAY_SPEED` in `lib/feed/CsvReplayFeed.ts`) |
| 9 | **Adherence** | Genesys has no adherence; it comes from NICE IEX, which is not connected. On live, adherence shows **N/A** on agent cards, My View and the Adherence tile ("No adherence feed"), and the Adherence breach rule cannot fire. The simulator invents values and a replay uses the file's; `deriveAdh` (drift by time in status) runs only for those. Until 10 Nov 2026 live showed a fixed 96% placeholder. Next: connect NICE IEX and pass its figure as `adh` on agent state events |
| 10 | **Calls waiting** | Not in Genesys interval exports, so the Queue backlog rule cannot fire on imported data |
| 11 | **One floor or several queues** | The console shows one set of queue numbers; the October export has 48 queues |
| 12 | **Status mapping table** | Genesys statuses are guessed by name (`guessState()` in `lib/csv/parse.ts`). Should be an agreed, editable list. The live feed's mapping is in `status_mapping` but not read: see item 26 |
| 13 | **Elevance Sans font** | Files were never supplied; the system font renders instead. Add the `@font-face` to `app/globals.css` when they arrive |
| 14 | **Smaller `bits-logo.png`** | The committed logo is 2.7 MB and could be replaced with a smaller export |
| 22 | **Rule overrides: Managers edit any Tower** | Phase 1 step 4 (9 Nov 2026). The decision is that a Manager edits only their own Towers, Sub-Towers and LOBs, but nothing links a Manager to a Tower yet, so any Manager can change any override. Needs that link (from the reporting lines or a list per Tower) before it can be enforced (`patchOverride()` in `app/api/rules/route.ts`) |
| 23 | **Admins and Senior Leaders audited by role only** | Since PR #52 every audited change keeps who (`actor_id`) and in what role (`actor_role`), and `changed_by` is filled for anyone with a `person` row. An Admin or Senior Leader has no person in the console's view, so their entries say only "admin" or "senior". Closes with sign-in that names each Admin (CGSAuth), then their Domain ID as `actor_id` |
| 24 | **Rule overrides: not tried in a browser** | The Rules tab's override rows, the place picker and the "Several LOBs" CSV are covered by tests but were never clicked through: the local database has no queue map yet. Upload the mapping workbook on the Console, then add, change and remove an override on the Rules tab |
| 25 | **Floor call-outs for a group: who sees them** | A queue rule that fires for a Tower, Sub-Tower or LOB is a floor call-out, so every leader role sees it, not only that group's leaders. Scope it to the group once leaders are linked to Towers (item 22) (`inScope()` in `lib/engine/scope.ts`) |
| 26 | **Admin screen for alert routes and the state mapping** | `notification_route_step` (who each strike reaches) and `status_mapping` (Genesys status to console state) are in the database but the app uses its own copy in the code (`stageFor()` in `lib/engine/escalation.ts`, `lib/feed/gencloud/state.ts`), so editing a row changes nothing. A test fails if they disagree. Build a screen to edit them, and have the engine and the feed load them from the tables at start-up. `genesys_region` is likewise a copy of `lib/orgs.ts` |
| 27 | **Reassigning an incident's owner** | Whoever starts an investigation owns it (deployed 9 Nov 2026, PR #53; see Section 8). Missing: handing it to someone else. Add an "Assign to" choice with item 7, saved with an audit entry. `priority` and `root_cause` stay empty by design (severity and dispositions cover them) |
| 28 | **History, audit and alert-log screens** | Closed call-outs and incidents from earlier days, `audit_event` and `notification_log` are saved and kept forever, but no screen shows them: the console shows today and what is open |
| 30 | **Filters and N/A: follow-ups** | From `feat/ui-multiselect-search` (10 Nov 2026). (a) Export CSV on the ledger and Export incidents CSV on the register still download everything, not what the search and queue filter show. (b) The ledger's stage filter is still single-pick. (c) The Offline N/A display was covered by tests but not seen on screen (the simulator had no Offline agents): check it on CGSPH after the deploy. (d) The LOB filter was tried in the browser with a made-up mapping only, since the simulator has none |

## 3. Engineering

| # | Item | Notes |
| --- | --- | --- |
| 15 | **Tests for API routes and screens** | The engine, import, feeds, store and PostgreSQL writes are tested; the API routes and screens are not |
| 16 | **Running more than one server** | The engine lives in one process, so the app cannot be load-balanced as is. Options are in the data architecture document, Section 9 |
| 17 | **Replay cleanup** | Abandoned replays stay in memory until the user exits or eight others push them out (`MAX_REPLAYS` in `lib/server/runtime.ts`). Add an idle timeout |
| 20 | **Data source switch: follow-ups** | Merged in PR #10 (7 Oct 2026). An Admin can switch the floor between the Gencloud feed and a simulation that uses real team and agent names (README, "Switching the data source"). Open: exports and the ledger of a simulation are not marked as simulated; team leads and managers in a simulation are still the sample ones, not the real supervisors the live floor now has |
| 19 | **Desktop alerts: production readiness** | Merged in PR #10 (7 Oct 2026). Since PR #18 a nudge alert goes only to the agent it is about; leaders get alerts for escalations, not nudge previews. Seen working in Chrome on Windows with the console tab in the background; not yet tried with the browser fully closed, or in Edge. Subscriptions are saved in `push_subscription` (Phase 1) but tied to the "View as" person until sign-in (`TODO(SSO)` in `lib/server/push.ts`). IT must confirm the firewall allows the Google and Microsoft push services, pre-grant the notification permission, and keep Chrome running in the background |
| 29 | **Updates missed while the app restarts (deploy gap)** | Found 10 Nov 2026. During a redeploy (`app-ctl stop` then `start`, about 10 seconds) nothing receives Genesys updates, and Genesys does not resend them. **Lost:** calls that end in the gap are not added to Calls, Xfr or Short and are not in `source_event_stream`, so no later restart rebuilds them (AHT is fine: it is Genesys's own figure); a breach already under way at reconnect is marked as raised (`seed` in `applyAgentState()`, `lib/engine/engine.ts`), so that occurrence gets no call-out. **Calls in progress at the restart** are learned only from their next update (`CallTracker` in `lib/feed/gencloud/conversations.ts`): if that update is the hang-up, the call is not counted; an agent still in ACW for a call that ended in the gap shows On Call (Genesys routing stays INTERACTING) until wrap-up ends, so Extended ACW cannot fire and Long call may. **The write queue is in memory and is not saved on stop** (no SIGTERM handler), so up to about a second of records can be lost. Fixes: (a) save the write queue on SIGTERM before exiting (`lib/store/postgres.ts`); (b) at start-up, read the active conversations on the watched queues so calls in progress and ACW are tracked from the start (`lib/feed/GencloudFeed.ts`); (c) optionally back-fill calls that ended in the gap from Genesys conversation details. Until then, deploy outside floor hours |
| 21 | **Design system: follow-ups** | Published on 8 Oct 2026 at https://claude.ai/artifact/Kpd3Lb6FXFS1tKrVqRVSR9 (private to its owner until shared), last synced from `main@b5f2469`. Rebuilt by the scripts in `tools/design-system` (see its README); publishing is a separate, manual step. Open: four colour pairs from the tokens miss contrast minimums and were kept as they are (field border `neutral-350` on white 1.5:1, subtle text `neutral-700` on white 3.8:1, `turquoise-text` on `pale-turquoise` 4.05:1, the `warning` card ring 1.7:1); previews use the system font until Elevance Sans arrives (item 13); editing a radius or spacing token on the page does not change the previews; `opssup-logo.png` was left out (item 18) |

## 4. Decisions waiting on someone

Settled and taken off this list: the database (PostgreSQL), the org structure (Genesys supervisors, with the CGS directory filling gaps, and the WFM mapping workbook), what a shift is (one US Eastern day), and raw events (kept for the current Eastern day only).

| Decision | Owner | Blocks |
| --- | --- | --- |
| Genesys access: OAuth grant, topics, current limits | Genesys administrator | Item 1 |
| Adherence source | WFM | Item 9 |
| Agreed status mapping | WFM | Item 12 |
| One floor or one set of numbers per LOB | WFM, Operations | Item 11 |
| Role matching for sign-in, and the Admin and Senior Leader list | IT, BITS, Operations | Item 2 |
| Which Towers, Sub-Towers and LOBs each Manager owns | WFM, Operations | Items 22 and 25 |

## 5. Small open points

- **Simulation guide cover** credits "Arielle Jimera, UI/UX Designer / Developer · BITS Automation Team", and the FAQ says to contact the BITS Automation Team. Wording not yet confirmed.
- **Guide screens are drawn mock-ups**, not screenshots. Real screenshots are an option.
- **Genesys details in the data architecture document** (topic names, about 1,000 subscriptions per channel, about 24-hour channel lifetime) come from public documentation and are not yet confirmed against the tenant.
- **Data architecture diagrams** are Mermaid and have not been checked as rendered on GitHub.
- **Nudge pop-up** was verified by its rendered content, never by screenshot.
- **Import dialog**: starting a replay and the error list were exercised through the API and tests, not clicked through in the browser.

## 6. Suggested next steps

- **On production:** see an incident's owner and notes survive a restart, once a third strike opens one.
- **Update `next`** to 16.4.1 or later (three advisories, none reachable in RTM today), with `eslint-config-next`. Never `npm audit fix --force`.
- **Item 24:** click through rule overrides in a browser, now that the queue map exists.
- **Item 7:** the incident-report form, with reassigning an incident's owner (item 27).
- **Item 19:** the desktop-alert checks below.
- **Item 2:** sign-in, when it comes off hold.

**Still to check on desktop alerts (item 19):**

1. Click "Got it", "Send reason" and "Acknowledge" on real notifications and confirm the instance changes in the ledger.
2. View as an agent, close the console, wait for a nudge, and confirm the pop-up is there when the console is opened again.
3. Close the browser completely and repeat in both Chrome and Edge. Chrome is expected to need its "continue running background apps" setting; Edge is expected to deliver through Windows.
4. Take the IT questions in item 19 forward.

## 7. Things to remember

- **The repository is public.** Never commit `GenCloudOverall/` (real exports with internal queue names and IDs), `design_handoff_rtm_console/`, or `docs/vrs-admin-manual.pdf`. All three are in `.gitignore`. The logos in `public/assets/logos/` are committed.
- **Three places this build deliberately differs from the design prototype:** Adherence breach and Transfer rate fire once per shift (the prototype re-fired them on every state change); Senior Leader has no Rules tab (follows `PERMS`); a replay is private to the session that started it.
- **Compact buttons are 32px** per the design README, although the prototype renders them at about 38px.
- **Commits** use Conventional Commits, authored as the repository owner with no co-author trailer. Work goes on a branch and through a pull request.
- **To rebuild the guides:** `python docs/build_pdf.py` for the simulation guide, `python docs/build_pdf.py backend` for the backend guide (run from Bash; needs Chrome or Edge, and `pip install pypdf`). Edit `docs/src/*.html`, not the PDFs.
- **Every gap or planned integration** goes in this backlog and in the backend guide's Known gaps.
- **To re-sync the design system:** `node tools/design-system/build.mjs` then `node tools/design-system/gen.mjs`; the output lands in the ignored `.design-system/` folder and is published to the artifact from there. The sample data in `tools/design-system/demo.ts` is invented and must stay that way.
- **Local dev:** `npm run dev`, with `.env.local` copied from `.env.example` (`NEXT_PUBLIC_FEED=sim`, `NEXT_PUBLIC_VIEW_AS=1`).

## 8. Done

| # | Item | How it was closed |
| --- | --- | --- |
| 3 | **Database** | PostgreSQL, decided October 2026. Phases 0 to 3 (24 tables) merged in PRs #39 to #52 and deployed to CGSPH on 9 November 2026 |
| 4 | **Real IDs instead of names** | Agents, call-outs and incidents are keyed by Genesys user ID (PR #46) |
| 5 | **Shift start and end** | One shift is one US Eastern day. At Eastern midnight the live floor starts a new `shift` row, strikes start again at zero and raw events are cleared (PRs #36 and #51). The simulator and replays do not roll over |
| 6 | **Org structure source** | Supervisors come from Genesys, with the CGS directory filling gaps (PR #48); Towers, Sub-Towers and LOBs come from the WFM mapping workbook (PR #49). About 35% of agents still have no supervisor in Genesys and reach admins only |
| 14 | **Logos in the repo** | Committed in PR #5. The smaller `bits-logo.png` stays open above |
| 18 | **Unused `opssup-logo.png`** | Removed from `public/assets/logos` |
| 27 | **Incident owner, closing note and comments** | Owner, notes and closing note deployed 9 November 2026 (PR #53). Reassigning stays open above |
