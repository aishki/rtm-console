# RTM Console · Ideal Dataflow and Schema

The target design for saving the console's data in PostgreSQL, for everyone building the backend. It replaces the earlier 12-table draft of this file.

- **Built on:** the 20 tables in the *PostgreSQL schema* doc, with the corrections in the [Backend Implementation Guide](RTM_Console_Backend_Guide.pdf) (Section 9), and the decisions recorded since (one incident per strike, `INC-YYYY-NNNN` restarting each January, a new day at midnight Eastern).
- **Adds two tables:** `queue_lob_map` (the WFM Queue-to-LOB mapping) and `rule_override` (thresholds per Tower, Sub-tower or LOB). **22 tables in all.**
- **Keeps the Word file:** all six tables of *RTM Dashboard Data Tables* are here under the same names (Section 2).
- **Diagrams:** [`.archify/rtm-ideal-erd.html`](../.archify/rtm-ideal-erd.html) (every table and column) and [`.archify/rtm-ideal-architecture.html`](../.archify/rtm-ideal-architecture.html) (from the feed to the screens). The `.json` next to each is its source.

This is a design, not code. Nothing here is built yet except Phase 0 (Section 7).

## 1. The flow

```
Genesys (WebSocket + REST) ─► Feed adapter ─► Rules engine (in memory, every second) ─► /api/stream (SSE) ─► Screens
        │                                         │   ▲                                         │
        │ raw events                              │   │ rules, overrides, Queue-to-LOB mapping  │ acks, comments,
        ▼                                         ▼   │ (loaded at start, cached)               │ incident actions,
  source_event_stream                     write-behind queue ──► PostgreSQL ◄──────────────────┘ rule edits (/api/*)
  (today only)                            (ordered, batched, retried)
```

The Word file's chain, **Event → Rule → Instance → Route → Notification → Incident**, holds exactly:

1. **Event.** The Gencloud feed turns each Genesys update into an agent state, a call event or queue numbers, using `status_mapping`. Each raw update is also written to `source_event_stream` (Phase 3).
2. **Rule.** The engine checks every enabled rule once a second. For each agent or group of queues it uses the **most specific setting**: the LOB override, else the Sub-tower override, else the Tower override, else the rule's default (Section 4).
3. **Instance.** A breach is a `monitoring_instance` row: the rule version and override that fired, the person or group, the value, the strike number and the stage. Strikes per agent per rule per day are kept in `agent_rule_state`.
4. **Route.** The rule's route (`notification_route` and its `notification_route_step` rungs) says who hears about strike 1, 2, 3 and later, by which channel, and when an incident opens.
5. **Notification.** Each recipient and channel is a `notification_log` row: popup, toast, push, and later email and Teams.
6. **Incident.** From strike 3 on, **every strike opens its own incident** (`incident_log`), numbered from `incident_counter`, saved in the same transaction as its call-out.

The engine stays in charge and in memory. It hands each record to the store (`lib/store/`), which writes it shortly after in order and retries on failure, so a slow database never holds up the one-second tick. On start-up the engine reloads the rules, overrides, mapping, today's shift, strikes, open call-outs and open incidents, and carries on.

## 2. The Word file's six tables, and where each field went

| Word file | Table here | Notes |
| --- | --- | --- |
| SourceEventStream | `source_event_stream` | Same fields. LOB, SubLOB and Team are not copied onto each event: an event names its agent or queue (`entity_type`, `entity_id`) and the hierarchy is a join. Holds **today only** (Section 6). |
| RulesMaster | `rules_master` + `rule_version` + `rule_override` | The rule itself in `rules_master`; its default threshold, severity, route and on/off in `rule_version`, a new row per edit; per-Tower, Sub-tower and LOB settings in `rule_override`. RuleScope becomes `rule_scope` (agent or floor) plus the override's level. |
| NotificationRoute | `notification_route` + `notification_route_step` | The RouteMap JSON becomes one row per rung (`min_occurrence`, `max_occurrence`, recipient roles, action owner, action, channels, `opens_incident`), so the database can check each one. |
| MonitoringInstance | `monitoring_instance` | All fields kept. EntityType/EntityID become `person_id` (agent rules) or the group's `tower`/`sub_tower`/`lob` (floor rules). LOB, SubLOB and Team are kept as they were at fire time. |
| NotificationLog | `notification_log` | One row per recipient per channel, so one failed push does not hide the others. Tracking only, never the message text. |
| IncidentLog | `incident_log` | All fields kept, plus the call-out that opened it (`instance_id`), the strike number and the disposition. |

The Word file's **LOB, SubLOB, Team** become the WFM mapping's **Tower, Sub-tower, LOB**, with the team (or queue) below them.

## 3. The 22 tables

Seven groups. **Built** means it exists in the Phase 0 migration today; its columns here are the built ones. Columns are listed in full in the ERD.

### 3.1 Genesys, queues and the Queue-to-LOB mapping

| Table | Holds | Key points |
| --- | --- | --- |
| `genesys_region` **Built** | US East, US West: API and login hosts | |
| `genesys_org` **Built** | Anthem Commercial, GBD, Specialty | `org_id` is the console's own key (`commercial`, `gbd`, `specialty`, as in `lib/orgs.ts`); `genesys_org_id` is Genesys's ID, unique, filled once known. |
| `queue` | Each Genesys queue seen | `queue_id` is the Genesys queue ID. `name_key` (`upper(trim(name))`, the same as `queueKey()`) joins it to the mapping. `watched` marks the queues the feed follows. `team_id`: today each queue is also a team. |
| `queue_member` | Who is on which queue | An agent on 16 queues is 16 rows. |
| `queue_lob_map` **New** | The uploaded WFM **Queue-to-LOB mapping** | One row per queue: `tower`, `sub_tower`, `lob`, the queue name as written, optional `region` and `org`. See below. |

`queue_lob_map` stores the upload the app already accepts (`lib/import/queueMap.ts`): an `.xlsx` with a sheet named **"Queue-to-LOB mapping"** and the columns Tower, Sub-tower, LOB and Queue, with Region and Org read when present. The rules stay as they are today:

- `queue_key` (the normalised queue name) is the primary key: on a duplicate, the first row wins and the dialog reports it.
- An upload **replaces only the towers in the file** and keeps every other tower: in one transaction, delete the rows of those towers and insert the new ones, plus one `audit_event`.
- `org_id` is resolved from the Org column; a row with no Org counts for every org.
- The mapping is also **the list of queues the feed watches**. It has no foreign key to `queue`, because it can name a queue before the feed has found it in Genesys (it then shows under "watched queues that are still unmapped").
- It replaces `.rtm/queue-map.json`. The app keeps a cached copy and a revision number, as `queueMapRev()` does today.

Workbooks from WFM (for example *RTM Dashboard Queue Mapping.xlsx*) are reference copies. The upload contract above is what the app reads; a workbook with another sheet name is renamed before upload.

### 3.2 People and the day

| Table | Holds | Key points |
| --- | --- | --- |
| `team` | Teams and their leaders | `tl_id`, `manager_id` point at `person`; role scoping joins through them. Its Tower, Sub-tower and LOB come from the mapping through its queue, not from columns of its own, so a correction is made in one place. |
| `person` | Agents and leaders | `person_id` is the Genesys user ID. One org per person (to be confirmed). `role` is one of the five console roles. |
| `push_subscription` | Browser push endpoints | Keyed by a hash of the endpoint. Deleted when the push service answers 404 or 410. |
| `shift` | One row per org per Eastern day | `org_id` + `shift_date` unique; one active shift per org; starts and ends at midnight Eastern. `floor_fired` lists the floor rules in breach now, each as rule and group (for example `sl@lob:Claims`). |
| `agent_rule_state` | Strikes per agent per rule per shift | `strikes` only. Strikes start at zero each day because a new shift has no rows; nothing is deleted. |

### 3.3 Rules and routes

| Table | Holds | Key points |
| --- | --- | --- |
| `rules_master` **Built** | The 14 rules | Name, type, `rule_scope` (agent or floor), metric, operator, `once_per_shift`, `current_version`. Names and conditions also live in the code (`defaultRules()`). |
| `rule_version` **Built** | Every version of a rule's **default** settings | `threshold`, `unit`, `severity`, `route_id`, `enabled`, who and when. Edits by one person within 2 seconds fold into one version (`lib/store/postgres.ts`). |
| `rule_override` **New** | Settings for one Tower, Sub-tower or LOB, versioned | See Section 4. |
| `notification_route` **Built** | The four routes | `nudge`, `lead`, `nudgeonly`, `leadonly`. |
| `notification_route_step` **Built** | Each rung of a route | Strike ranges, stage, recipient roles, action owner, action, channels, `opens_incident`. |

### 3.4 Call-outs, incidents and delivery

| Table | Holds | Key points |
| --- | --- | --- |
| `monitoring_instance` | Every call-out | Points at the exact `rule_version` and, when one applied, the `rule_override` row. `person_id` is null for floor call-outs, and then `occurrence_count` is 0. `tower`, `sub_tower`, `lob` and `team_id` are copied at fire time. `source_event_id` has no foreign key: duration rules fire from the clock, not from one event, and the events table is emptied daily. |
| `incident_log` | Investigations | **One per strike from 3 on.** `instance_id` (the call-out that opened it) is unique, and `strike` is 3 or more. No "one open incident per agent and rule" index. Status Open → Investigating → Closed; closing needs a final disposition. |
| `incident_counter` | The last incident number per year | One counter for every org, so numbers never repeat across orgs; 0001 again each January (Eastern date). The engine numbers in memory and continues from this table at start-up. |
| `notification_log` | Each delivery to each recipient | Partitioned by month, with a default partition and three months ahead. Channel `popup`, `toast`, `preview`, `push`, `email`, `teams`. Delivery status `sent`, `shown`, `delivered`, `expired`, `gone`, `failed`. What the person did: `got_it`, `send_reason`, `acknowledge`. |

The incident's call-out is reached through `incident_log.instance_id`; the instance does not also point back at its incident, so the link is kept in one place.

The dispositions are the twelve in `DISPOSITIONS` (`lib/engine/rules.ts`), matching WFM's *List of Actions*: Coached; Coached & Documented; Assisted & Coached; Excused/Validated; Uncontrollable/No-Fault; System/Tool Issue; Refresher Training Assigned; Approved Business Activity; Invalid/Disputed; Corrective Action Initiated; Escalated to Leadership/HR; Pending Investigation. "Pending Investigation" does not allow a close.

### 3.5 Raw events, status mapping and audit

| Table | Holds | Key points |
| --- | --- | --- |
| `source_event_stream` | Today's raw Genesys updates | Agent presence and routing, call events, queue numbers. Inserted many rows at a time about once a second. **Today only**: emptied with `TRUNCATE` at midnight Eastern, so not partitioned. |
| `status_mapping` **Built** | Genesys status → console state | Checked in priority order; the first match wins; no match is Aux Personal. The seven states: `oncall`, `avail`, `acw`, `auxb`, `auxp`, `outb`, `off`. |
| `audit_event` **Built** | Admin and leader actions | Rule and override edits, mapping uploads, incident moves, ack-all, feed switches, token refreshes; before and after as JSON. |

## 4. Thresholds by Tower, Sub-tower and LOB

### What an override is

`rule_override` holds one rule's settings for one place in the hierarchy:

| Column | Meaning |
| --- | --- |
| `override_id` | Identity; what a call-out points at. |
| `rule_id` | The rule. |
| `tower`, `sub_tower`, `lob` | The place. `sub_tower` and `lob` are `''` above their level: `('Provider', '', '')` is a Tower override; `('Provider', 'Claims', '')` a Sub-tower one; `('Provider', 'Claims', 'Local')` a LOB one. A LOB needs its Sub-tower. Names match `queue_lob_map`. |
| `scope_level` | Generated from the three: `tower`, `sub_tower` or `lob`. |
| `version` | 1, 2, 3 … per rule and place. The highest is current. Unique with `rule_id`, `tower`, `sub_tower`, `lob`. |
| `threshold`, `severity`, `route_id`, `enabled` | Each **null means "inherit from the level above"**. An override can change only the threshold and keep the default severity and route. A version with all four null removes the override. |
| `changed_by`, `changed_at`, `change_reason` | Who, when and why. |

The unit stays the rule's (`rule_version.unit`): an override cannot turn seconds into percent.

### Which setting applies

For each setting separately, the most specific one that is set wins:

```
LOB override  →  Sub-tower override  →  Tower override  →  rule default (rule_version)
```

Example: *Extended ACW* defaults to 120s, warn, route `nudge`. Provider has a Tower override of 180s. Provider › Claims › Local has a LOB override setting severity to `crit`. An agent in Local gets 180s, crit, route `nudge`.

### Which place an agent or a queue is in

- **Agent rules** (ACW, Aux, Overbreak, Offline, Long call, Hold, Outbound, Short call, Adherence, Transfer rate): the agent's home queue, which is their `team` today (the first queue they are listed in), looked up in `queue_lob_map`. An agent whose queue is unmapped gets the default.
- **Queue rules** (Queue backlog, Service level, Abandon rate): checked for the whole floor against the default, as today, and **also for each Tower, Sub-tower and LOB that has an override**, against that group's numbers rolled up by calls (as the agent grid already rolls them up, `lib/queueStats.ts`). A breach names the group in `tower`/`sub_tower`/`lob`.
- **System rule** (Gencloud not responding): default only. The app refuses an override for a `system` rule.

### Editing

- In the Rules tab, a rule shows its default and, below it, its overrides by Tower, Sub-tower and LOB. The roles with `rulesEdit` (Admin, Manager) can add, change and remove them.
- An edit inserts a new `rule_override` version and an `audit_event`. Quick edits by one person fold into one version, as rule edits do today.
- Proposed API, next to today's `PATCH /api/rules` (`{ id, thr?, sev?, route?, on? }`): `PATCH /api/rules` with a `scope: { tower, subTower?, lob? }` field for an override, and `null` in a field to inherit.
- Every call-out keeps `rule_version` and `rule_override_id`, so the ledger can always show the setting that fired it, even after later edits.

## 5. The screens and their tables

| Screen | Reads | Writes |
| --- | --- | --- |
| **Console** (agent grid, queue tiles, Tower tree) | Engine state in memory; `queue_lob_map`, `queue`, `queue_member` for grouping; `source_event_stream` only at start-up | Mapping upload → `queue_lob_map`, `audit_event` |
| **Ledger** | `monitoring_instance` with `person`, `team`, `rule_version`, `rule_override` | Ack, ack-all, comment → `monitoring_instance` (+ `audit_event` for ack-all) |
| **Dashboards** (incidents) | `incident_log` with its `monitoring_instance` | `POST /api/incidents/[inc]`: start, reopen, record disposition, close → `incident_log`, `audit_event` |
| **Rules** | `rules_master`, current `rule_version`, current `rule_override` rows, `notification_route` | Rule and override edits → `rule_version` / `rule_override`, `audit_event` |
| **My View** and the nudge | The agent's own `monitoring_instance` rows | Got it, Send reason → `monitoring_instance`, `notification_log.action` |

Everything is scoped on the server: a Team Lead's ledger is a join through `team.tl_id`, a Manager's through `team.manager_id`, an agent's on `person_id`; floor call-outs show to every leader.

## 6. Kept, and never stored

- **Kept for good:** rules and their versions, overrides, routes, people, shifts, strikes, call-outs, incidents, deliveries and audit.
- **Kept for one day:** raw events. At midnight Eastern `source_event_stream` is emptied, through the same ordered write queue, so an event from 23:59:59 never lands after it. Call-outs and incidents carry over midnight; open ones stay on screen until handled.
- **Never stored:** CSV replays (private to a session), agent timers (rebuilt from a fresh Genesys snapshot at start-up), and the simulator, unless a setting turns it on under its own org and people.
- **Times:** `timestamptz` everywhere, with the real date. The engine's seconds since midnight drive the screen only.

## 7. Build order

| Phase | Migration | Tables | State |
| --- | --- | --- | --- |
| 0 | `reference` | `genesys_region`, `genesys_org`, `notification_route`, `notification_route_step`, `rules_master`, `rule_version`, `status_mapping`, `audit_event` | **Done** (PR #39). Rules survive a restart. |
| 1 | `people_and_queues` | `team`, `person`, `queue`, `queue_member`, `push_subscription`, `queue_lob_map` | Needs Genesys IDs in the engine (backlog item 4). Adds the `person` foreign keys Phase 0 left out. Moves the mapping off `.rtm/queue-map.json`. |
| 2 | `shifts`, `callouts_and_incidents` | `shift`, `agent_rule_state`, `monitoring_instance`, `incident_counter`, `incident_log`, `notification_log` | After Phase 1. Recovery after a restart. |
| 2 | `rule_overrides` | `rule_override` | After Phase 1 (needs `queue_lob_map` and `person`), before or with the call-outs, so `monitoring_instance.rule_override_id` has its target. Engine and Rules tab change with it. |
| 3 | `events` | `source_event_stream` | After Phase 2. The day's KPIs survive a restart. |

Rules for every migration: never edit one that has run outside your PC (write a new one); production only goes forward; add freely, and rename or drop over two releases; run `npm run db:types` and commit `lib/db/schema.ts` with it.

## 8. Open decisions

| Decision | Why it matters | Proposed |
| --- | --- | --- |
| An agent on queues in several LOBs | Which LOB's threshold applies to them | Their home queue (`team`), as above |
| Where TLs and Managers come from (backlog item 6) | `team.tl_id`, `team.manager_id`, role scoping | Open. The WFM roster workbook has Tower, Sub-tower, LOB, Org and Region per employee but no team, TL or manager, and is keyed by employee ID, not Genesys user ID |
| Whether a Manager may edit overrides outside their own span | Rules tab permissions | Admin: any; Manager: only Towers, Sub-towers and LOBs of their teams |
| One org per person | `person.org_id` | Assumed; add a `genesys_account` table if not |
| Overrides per org | The same Tower name in two orgs | One override for the Tower in every org, matching how the mapping upload works |
