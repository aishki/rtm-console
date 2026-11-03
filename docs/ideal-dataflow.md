# RTM Console — Ideal Production Dataflow & Backend Implementation Blueprint

## 1. Executive Summary

This specification establishes the **To-Be Operational Dataflow** for the RTM Console. It bridges the foundational business requirements from `docs/RTM Dashboard_Data Tables.docx` with the technical realities of the Next.js/React full-stack application.

```
[ GenCloud Feed (WS / REST) ] 
              │
              ▼ (Hop 1: Ingestion)
[ source_event_stream (JSONB) ] ──────────► [ Console Tab: Live Floor KPIs ]
              │
              ▼ (Hop 2: Multi-Level Scoped Evaluation)
[ rules_master & rule_version ] (Tower ──► Sub-Tower ──► LOB ──► Team ──► Queue ──► Agent)
              │
              ▼ (If Rule Violated)
[ monitoring_instance ] ──────────────────► [ Instance Ledger Tab: Broken Rules & Strikes ]
              │
              ├───────────────────────────► [ notification_log: Toast / Popup / Email ]
              ▼ (If Strike 3 / Critical)
[ incident_log ] ─────────────────────────► [ Dashboard Tab: Incident Actions & Dispositions ]
```

---

## 2. UI Surface to Database Schema Mapping

| UI Surface | Data Source Entity | Update Frequency | Purpose & Content |
| :--- | :--- | :--- | :--- |
| **Console Tab** | `source_event_stream`<br>*(joined with `queue_map`)* | Real-time (1s tick / push) | Computes real-time floor telemetry: Queue Calls Waiting (`cq`), Service Level (`sl`), Average Speed of Answer (`asa`), Abandonment (`ab`), Agent State distribution, and Active Roster counts. |
| **Instance Ledger Tab** | `monitoring_instance`<br>*(joined with `rules_master`, `person`)* | Event-driven (on rule break) | Displays all active/historical broken rules, occurrence counts (strikes 1, 2, 3), acknowledging supervisor, violation duration, and current notification stage. |
| **Dashboard Tab** | `incident_log`<br>*(joined with `monitoring_instance`)* | Transactional / Real-time | Surfaces formal incidents requiring investigation. Enables managers to take corrective actions, record root cause, set dispositions (`Coached`, `System Issue`, `False Positive`), and close incidents. |
| **Rules Manager Tab** | `rules_master`<br>*(joined with `rule_version`, `notification_route`)* | On-demand / CRUD | Displays and configures monitoring thresholds across Tower-to-LOB hierarchy. Displays historical revision audit logs (`rule_version`). |

---

## 3. The Target 12-Table Relational Schema

### 3.1. Telemetry & Taxonomy Layer
1. **`source_event_stream`**
   - **Role:** Canonical write-ahead log for **all live incoming telemetry** from GenCloud WebSocket and REST feeds (capturing both triggered and non-triggered events).
   - **Entity Relationships:** Foreign key `person_id` references `person.person_id` (identifying the agent), and `queue_id` references `queue_map.queue_id` (identifying the queue).
   - **Columns:** `event_id` (PK, BigInt/UUID), `person_id` (FK to `person`), `queue_id` (FK to `queue_map`), `source_system`, `event_timestamp`, `entity_type` (`agent` | `queue` | `system`), `entity_id`, `metric_name`, `metric_value`, `event_payload` (JSONB), `processed_flag`, `processed_date`.
   - **Optimization:** Partitioned by month in PostgreSQL; raw JSON payload kept in `JSONB` for complete fidelity.
2. **`status_mapping`**
   - **Role:** Normalization matrix translating Genesys presence, routing status, and call signals into the 7 Console states.
   - **Columns:** `priority` (PK, SmallInt), `signal` (`presence` | `routing` | `call`), `genesys_status`, `console_state` (`oncall` | `avail` | `acw` | `auxb` | `auxp` | `outb` | `off`).
3. **`team`**
   - **Role:** Organizational anchor holding lines of business, tower classification, and leadership hierarchy.
   - **Columns:** `team_id` (PK, Text), `name`, `lob`, `sub_lob`, `tower`, `tl_person_id` (FK to `person`), `mgr_person_id` (FK to `person`).
4. **`queue_map`**
   - **Role:** Organizational taxonomy mapping WFM hierarchy to watched queues.
   - **Columns:** `queue_id` (PK), `team_id` (FK to `team`), `queue_name`, `tower`, `sub_tower`, `lob`, `sub_lob`, `watched` (Boolean), `updated_at`.

### 3.2. Governance & Rules Layer
5. **`rules_master`**
   - **Role:** Active business rules definition supporting Tower-to-LOB hierarchical scoping.
   - **Columns:** `rule_id` (PK), `route_id` (FK to `notification_route`), `rule_name`, `scope_level` (`tower` | `sub_tower` | `lob` | `team` | `queue` | `agent`), `scope_target` (e.g. `'Enterprise Ops'`, `'Claims LOB'`), `metric_name`, `operator` (`>` | `<` | `=` | `>=` | `<=`), `threshold_value` (Numeric), `severity` (`warn` | `crit`), `current_version` (Integer), `enabled` (Boolean), `created_date`, `modified_date`.
6. **`rule_version`**
   - **Role:** Immutable audit trail of every threshold revision or rule modification.
   - **Columns:** `version_id` (PK, BigInt), `rule_id` (FK to `rules_master`), `version_number`, `scope_level`, `scope_target`, `threshold_value`, `operator`, `severity`, `route_id`, `change_reason`, `modified_by` (FK to `person`), `effective_at`.
7. **`notification_route`**
   - **Role:** Occurrence-based progression matrix defining action requirements per strike.
   - **Columns:** `route_id` (PK), `route_name`, `description`, `route_map` (JSONB: array of occurrences, recipient role, action owner, and required action), `enabled`.

### 3.3. Operational Ledger, Nudges & Incident Layer
8. **`monitoring_instance`**
   - **Role:** The operational ledger recording each rule violation episode. Every time an incoming event violates a rule, a new instance is created (or strike count is incremented).
   - **Causal Ingestion Link:** Explicit foreign key `source_event_id` references `source_event_stream.event_id`, preserving the exact raw telemetry that triggered the violation. Foreign key `person_id` references `person.person_id`.
   - **Columns:** `instance_id` (PK, BigInt), `rule_id` (FK to `rules_master`), `source_event_id` (FK to `source_event_stream`), `person_id` (FK to `person`), `metric_name`, `metric_value`, `threshold_value`, `severity`, `occurrence_count` (Integer strike count), `status` (`open` | `acknowledged` | `resolved`), `acknowledged_by`, `acknowledged_date`, `current_notification_level`, `comments`, `created_date`, `last_updated_date`.
9. **`notification_log`**
   - **Role:** Delivery dispatch history for every single instance notification and nudge.
   - **Every Instance Notifies:**
     - **Strike 1 (`nudge`):** Pop-up Nudge sent to the Agent (`Associate`).
     - **Strike 2 (`lead`):** Toast Alert sent to the Team Lead (`Coaching`).
     - **Strike 3 (`ops`):** Escalation Toast sent to the Manager (`Ops Review`) alongside incident creation.
   - **Columns:** `notification_id` (PK, BigInt), `instance_id` (FK to `monitoring_instance`), `notification_timestamp`, `recipients` (JSONB array), `channel` (`popup` | `toast` | `email` | `teams`), `notification_level`, `delivery_status`, `created_date`.
10. **`incident_log`**
   - **Role:** Formal investigation records for repeated violations (Strike 3) or critical events requiring documentation, root cause analysis, and corrective actions.
   - **Columns:** `incident_id` (PK, BigInt), `incident_number` (Text, generated via native sequence `INC-YYYY-NNNN`), `instance_id` (FK to `monitoring_instance`), `person_id` (FK to `person`), `owner`, `priority`, `status` (`Open` | `Investigating` | `Closed`), `root_cause`, `resolution`, `open_date`, `close_date`, `comments`, `created_date`, `modified_date`.

### 3.4. Identity & Audit Layer
11. **`person`**
    - **Role:** Agent roster and Console user RBAC.
    - **Organizational Link:** Foreign key `team_id` references `team.team_id`, placing agents and supervisors in their organizational unit.
    - **Columns:** `person_id` (PK, Genesys User ID), `team_id` (FK to `team`), `name`, `email`, `role` (`admin` | `senior` | `mgr` | `tl` | `agent`), `account_state`, `push_endpoints` (JSONB), `last_login_at`.
12. **`audit_event`**
    - **Role:** Enterprise security audit logging for administrative actions, threshold changes, and feed overrides.
    - **Columns:** `audit_id` (PK, BigInt), `person_id` (FK to `person`), `action`, `target_entity`, `details` (JSONB), `created_at`.

---

## 4. Multi-Level Rules Engine Architecture (Tower to LOB)

Contact centers require granular governance where different lines of business or operational towers enforce tailored thresholds (e.g. Claims ACW threshold = 120s, Pharmacy ACW threshold = 180s).

### Hierarchy Resolution Order:
When evaluating an incoming agent or queue event, the Rules Engine checks for rules in descending order of specificity:
```
1. Agent Specific Override   (scope_level = 'agent', scope_target = person_id)
2. Queue Specific Rule       (scope_level = 'queue', scope_target = queue_id)
3. Team Specific Rule        (scope_level = 'team', scope_target = team_name)
4. LOB Rule                  (scope_level = 'lob', scope_target = lob_name)
5. Tower Rule                (scope_level = 'tower', scope_target = tower_name)
6. Enterprise Global Rule    (scope_level = 'system', scope_target = 'ALL')
```
*The most specific enabled rule matching the entity's organizational hierarchy wins.*

---

## 5. Backend Implementation Roadmap (What Must Be Updated)

### Step 1: Database Connection & Schema Migration
- **Current State:** Runtime state is entirely in-memory (`lib/server/queueMapStore.ts`, `lib/server/runtime.ts`).
- **Required Update:**
  - Introduce PostgreSQL connection pool (via `pg` or `postgres` with Drizzle / Kysely).
  - Deploy migration creating the 11 tables with appropriate indexes:
    - Partial unique index on `incident_log (person_id, instance_id) WHERE status <> 'Closed'` to prevent duplicate open incidents.
    - B-Tree index on `source_event_stream (event_timestamp DESC, entity_id)`.
    - Native PostgreSQL sequence: `CREATE SEQUENCE incident_seq START 1001;`.

### Step 2: Telemetry Ingestion Pipeline (`lib/feed/GencloudFeed.ts` & `lib/server/runtime.ts`)
- **Current State:** WebSocket telemetry is pushed into transient in-memory queues and discarded after processing.
- **Required Update:**
  - Batch incoming WebSocket events and execute asynchronous micro-batch `INSERT INTO source_event_stream`.
  - Normalize incoming presence/routing statuses using cached `status_mapping` table rows.

### Step 3: Scoped Rules Engine (`lib/engine/engine.ts` & `lib/engine/rules.ts`)
- **Current State:** Hardcoded rules in `lib/engine/rules.ts` evaluated uniformly across all agents.
- **Required Update:**
  - Query active rules from `rules_master`.
  - Implement the Tower-to-LOB scope resolver against the entity's WFM hierarchy (from `queue_map`).
  - When a rule condition is met, persist a `monitoring_instance` row and increment occurrence strike counts.
  - On rule edit via API (`PUT /api/rules/:id`), insert a new snapshot row into `rule_version` before updating `rules_master`.

### Step 4: Escalation & Incident Management (`lib/engine/escalation.ts` & API routes)
- **Current State:** Incidents exist as plain JavaScript objects in `engine.ts` state.
- **Required Update:**
  - When `monitoring_instance.occurrence_count >= 3` or rule severity is `crit`, execute transaction creating `incident_log` record with formatted `incident_number` (`INC-` + Year + `-` + Sequence).
  - Persist notification deliveries into `notification_log`.
  - Expose REST endpoints for Dashboard actions (`POST /api/incidents/:id/action`) to update `incident_log.status`, `disposition`, and `resolution`.

### Step 5: Queue Map Store Synchronization (`lib/server/queueMapStore.ts`)
- **Current State:** Reads and writes to local disk `.rtm/queue-map.json`.
- **Required Update:**
  - Modify `loadQueueMap()` and `saveQueueMap()` to persist rows to the `queue_map` table in PostgreSQL.
  - Maintain an in-memory cached copy with atomic `queueMapRev()` invalidation for high-performance tick loops.

---

## 6. Verification & Artifact Reference

The architecture and schema have been validated and rendered via **Archify**:
- **Ideal ERD Visualization:** `.archify/rtm-ideal-erd.html` (Interactive 12-table schema with views).
- **Ideal Architecture Runtime Diagram:** `.archify/rtm-ideal-architecture.html` (End-to-end dataflow from Ingestion to UI tabs).
