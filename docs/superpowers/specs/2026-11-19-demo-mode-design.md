# Demo mode — design

Date: 2026-11-19 · Status: draft for approval

## Intent

The RTM Console is being pitched for a pilot in a live presentation that happens **off hours**, when the
real floor is nearly empty: no agents working, nothing breaching, nothing to call out. Demo mode gives the
presenter a floor that looks like a busy shift on the real Genesys structure, so every beat of the script
lands on screen:

1. **Console** — the whole floor on one screen, at real scale (both orgs: 5,000+ agents, 370+ queues, 50+ LOBs).
2. **Rules Engine** — 14 rules, limits managers can change.
3. **Nudge** — the agent's pop-up asking for a reason, appearing *when the presenter says it does*.
4. **Escalation** — the same agent again → team lead; a third time → operations, incident opens automatically.
5. **Instance Ledger** — hours of call-outs: who, which rule, who acknowledged and when, the agent's own reason.
6. **Dashboards** — patterns by team, with a shift's worth of history.

## Goals

- A third floor source, **Demo**, alongside Gencloud and Simulator, switched from the context bar by an admin
  (the existing `setFloorSource` path; "for everyone", like the simulator today).
- **Real structure, invented people.** Teams, queues, LOBs, towers and the counts of each come from the cached
  rosters of **both** orgs (US East Commercial, US West GBD + Specialty) and the queue map. Every person's
  name — agents, team leads, managers — is invented. No real Genesys user ID appears.
- **Pre-filled shift.** On switching to Demo, the floor already looks ~3 hours into a shift: a few hundred
  Ledger rows, most acknowledged, many with agents' reasons; open and closed incidents; dashboards with history.
- **On-cue presenter triggers.** A keyboard shortcut fires the next escalation step for one demo agent:
  press 1 → nudge (strike 1), press 2 → team lead (strike 2), press 3 → operations + incident (strike 3).
- **The presenter sees the nudge.** While the floor is Demo, the nudge pop-up shows on the presenter's screen
  regardless of their role (today `NudgePopup` shows only to the agent the nudge is about).
- The floor keeps moving organically between triggers (states change, other call-outs appear now and then).

## Non-goals

- No change to the Gencloud floors or the existing Simulator.
- Not a training sandbox or a hosted demo link for outsiders.
- No scripted, timed playback of the whole presentation; the presenter drives the cues.

## Anti-goals (failure even if it works)

- **A real person's name next to an invented infraction**, anywhere: grid, Ledger, incidents, dashboards,
  exports, desktop alerts.
- **Demo data in the real record**: nothing from the Demo floor is saved to PostgreSQL / `.rtm/` (call-outs,
  incidents, comments, acks), and Demo never touches the incident or call-out counters the Genesys floors share.
- **Desktop pushes from the Demo floor** reaching anyone's real browser.
- **A team lead mistaking the demo floor for the real one** (see Status label).
- The simulated feed outage (`SimFeed.outageAt`) firing mid-presentation.

## Constraints

- One long-lived Node process holds all runtimes (`lib/server/runtime.ts`); the Gencloud floors keep running
  quietly while Demo is on screen.
- 5,000+ simulated agents must tick once per second without lagging the stream or the browser.
- Next.js 16 conventions in this repo differ from older docs (`AGENTS.md`).

## Approaches considered

1. **Per-session demo floor, built like CSV replays** (`startReplay` / `runtimeFor(sid)`). Fully isolated:
   only the presenter's session sees it. Trade-off: new per-session plumbing.
2. **Demo as a third floor source** next to Gencloud and Simulator, switched from the context bar.
   Reuses the existing switch and stream plumbing; trade-off: it switches the floor for everyone.
3. **A separate demo deployment** with the memory store and a copy of the structure. Most isolated;
   trade-off: a second server to deploy and keep current.

**Chosen: 2** (the user's pick). The "for everyone" risk is acceptable off hours; the visible "Demo floor" label and the manual toggle cover it.

## Design

### Floor source

- `FeedKind` / `FloorSource` gain `"demo"`. `/api/feed` accepts it (admin only, same `feed` permission).
- `createDemo()` in `lib/server/runtime.ts`, alongside `createSim()`: its own `registry.floors.demo`, started
  fresh on every switch, stopped and dropped when switching away.
- The Demo runtime **does not** call `pushBatch` and has no recorder: nothing saved, nothing pushed.
- The context bar's floor switch gains a "Demo" option.

### The demo floor (seed)

- Built from `loadRoster(org)` for every org plus `loadQueueMap()`: the real teams, queue membership,
  LOB/tower placement, and the real number of agents per team.
- Every agent, team lead and manager gets an invented name, deterministic from a fixed seed so rehearsal and
  presentation look the same. Uids are `demo:<n>` — never a Genesys ID.
- The `teamLines` / people directory is rebuilt over the invented names so "View as" team lead / manager
  scopes still work on the demo floor.
- If no roster is cached for an org, that org's part falls back to the Simulator's sample structure, and the
  switch response says so.

### Movement

- Reuses `SimFeed` behavior (state changes, queue drift, organic repeat offenders) scaled to the full floor,
  with **no feed outage** and a lower organic call-out rate so cued beats stand out.

### Pre-filled shift

- Like the Simulator's `warm()`, but ~3 hours (floor clock starting around 08:00, demo opening near 11:00):
  Ledger rows acknowledged at realistic rates, agents' reasons via `simulateReplies`, a handful of incidents
  opened by the third-strike rule and some of them closed with dispositions.
- Warm-up must finish within a few seconds of the switch; how (fewer ticks with larger steps, warming only
  agents who will have history, or synthesising history directly) is the builder's call.

### Presenter cues

- Keyboard shortcut, active only while the floor is Demo and the viewer can switch feeds (admin):
  - `1` → the cue agent breaches a rule → nudge (strike 1); the nudge pop-up appears on the presenter's screen.
  - `2` → same agent, same rule, again → escalates to team lead.
  - `3` → again → operations; incident opens.
  - `0` → reset: pick a fresh cue agent (no strikes) for another run-through.
- Server endpoint (e.g. `POST /api/demo/cue`) applies the step to the Demo runtime only; refused on any other floor.
- The cue agent and rule are pre-chosen and fixed for the session: an agent on a visible team with no strikes
  on that rule. Default rule: **Overbreak**, matching the script's first example ("a break that runs too long").
- No visible on-screen control; the shortcut is the only trigger.

- Each cue makes the breach visible, not instant: the cue agent's state is set (e.g. on break) with its start
  backdated past the limit, so the grid shows a believable 15+ minute break when the call-out fires.

### Nudge visibility

- While the floor is Demo, `NudgePopup` shows **the cue agent's** nudges to the presenter (any role), with the
  invented agent's name, so the audience sees what the agent would see. Organic nudges for other demo agents
  never pop up on the presenter's screen.
- The pop-up's buttons work: "Got it" acknowledges and "Send reason" records the typed text as the invented
  agent's reason, on the Demo runtime only, so it shows in the Instance Ledger right away.

### Rules on the Demo floor

- The Demo runtime takes a **copy** of the real rules when it starts. Rule edits made while the floor is Demo
  change that copy only: no store write, no audit entry, no effect on the Gencloud floors. The copy is dropped
  when the Demo floor stops.

### Safeguards

- **No auto-return** (user's call): Demo stays on until an admin toggles it off from the context bar.
  The status label below is what tells anyone who opens the console that they're on the demo floor.
- Switching away goes back to the org that was on screen before Demo started.

### Status label

- While the floor is Demo, the context bar shows a plain **"Demo floor"** label (in the style of today's
  "Simulation · sample floor"), to every viewer. Nothing presents demo activity as live.
- The switch is logged through `store().feedSwitched`, as today.

## Decided by the user

- Purpose: live, off-hours pilot presentation following the script above.
- Invented names for people; real structure kept.
- Pre-filled shift plus on-cue triggers.
- Approach 2: Demo as a third floor source.
- A plain "Demo floor" label is shown; the script line becomes "running on a demo floor built on our real
  structure, because the floor is closed right now."
- The presenter can type a reason in the nudge and it lands in the Ledger live.
- Demo is a manual toggle; no automatic switch-back.

## My calls (flagged for review)

- Team lead and manager names are invented too, not only agents'.
- Both orgs' structures merged onto one Demo floor (the script says "both our US East and US West").
- Keyboard cues `1`/`2`/`3`/`0`; cue rule defaults to Overbreak.
- Deterministic names from a fixed seed.
- Rule edits on the Demo floor stay in a demo-only copy (keeps the "nothing in the real record" anti-goal).
- Only the cue agent's nudges pop up for the presenter; organic ones don't.
- Cues set the agent's state with a backdated start, so the grid shows the breach before the call-out.
- Leaving Demo returns to the org shown before it.

## Left to the builder

- How warm-up meets the few-seconds budget at full scale.
- Where the shortcut listener lives, and how the cue agent is chosen and surfaced to the presenter.
- Exact organic call-out rate on the Demo floor.
- Tests: no real uid or name in the Demo runtime's state; no store writes or pushes from it; cue steps
  produce nudge → lead → ops + incident in order.
