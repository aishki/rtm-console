import { type Kysely, sql } from "kysely";

// Phase 0: the reference data. Genesys regions and orgs, the four alert routes and their rungs, the
// 14 rules (each at version 1), the Genesys status mapping and the audit trail.
//
// The rows are written out here, not taken from the app's code, so this migration does the same
// thing on every database whatever the code later becomes. Once it has run anywhere but a
// developer's PC, never edit it: write a new migration.
//
// rule_version.changed_by, status_mapping.updated_by and audit_event.actor_id will point at
// person. That table comes in Phase 1, which adds the foreign keys.

/* eslint-disable @typescript-eslint/no-explicit-any -- a migration is frozen in time, so it does not use the app's table types */

const REGIONS = [
  { region_id: "us-east-1", name: "US East", api_host: "api.mypurecloud.com", login_host: "login.mypurecloud.com" },
  { region_id: "us-west-2", name: "US West", api_host: "api.usw2.pure.cloud", login_host: "login.usw2.pure.cloud" },
];

/** org_id is the console's own key for an org (lib/orgs.ts). The Genesys organization ID is added once known. */
const ORGS = [
  { org_id: "commercial", region_id: "us-east-1", name: "Anthem Commercial" },
  { org_id: "gbd", region_id: "us-west-2", name: "Anthem GBD" },
  { org_id: "specialty", region_id: "us-west-2", name: "Anthem Specialty" },
];

const ROUTES = [
  { route_id: "nudge", route_name: "Agent nudge → TL → Ops", description: "Strike 1 nudges the agent, strike 2 goes to the Team Lead, strike 3 and later to Ops with an incident." },
  { route_id: "lead", route_name: "TL first → Ops", description: "Strikes 1 and 2 go to the Team Lead, strike 3 and later to Ops with an incident." },
  { route_id: "nudgeonly", route_name: "Agent nudge only (no escalation)", description: "Every strike nudges the agent. Never escalates." },
  { route_id: "leadonly", route_name: "TL only (no auto-Ops)", description: "Every strike goes to the Team Lead. Never escalates to Ops." },
];

const NUDGE = { stage: "nudge", recipient_roles: ["agent"], action_owner: "agent", action: "Review", channels: ["popup", "push"] };
const LEAD = { stage: "lead", recipient_roles: ["tl"], action_owner: "tl", action: "Coaching", channels: ["toast", "push"] };
const OPS = { stage: "ops", recipient_roles: ["tl", "mgr", "admin", "senior"], action_owner: "mgr", action: "Create incident", channels: ["toast", "push"], opens_incident: true };

/** Strike 0 is a floor call-out (no agent): it stays on the route's first rung. Matches stageFor() in lib/engine/escalation.ts. */
const STEPS = [
  { route_id: "nudge", step_no: 1, min_occurrence: 0, max_occurrence: 1, ...NUDGE },
  { route_id: "nudge", step_no: 2, min_occurrence: 2, max_occurrence: 2, ...LEAD },
  { route_id: "nudge", step_no: 3, min_occurrence: 3, max_occurrence: null, ...OPS },
  { route_id: "lead", step_no: 1, min_occurrence: 0, max_occurrence: 2, ...LEAD },
  { route_id: "lead", step_no: 2, min_occurrence: 3, max_occurrence: null, ...OPS },
  { route_id: "nudgeonly", step_no: 1, min_occurrence: 0, max_occurrence: null, ...NUDGE },
  { route_id: "leadonly", step_no: 1, min_occurrence: 0, max_occurrence: null, ...LEAD },
];

type Seed = [id: string, name: string, type: string, cond: string, metric: string, op: string, thr: number, unit: string, sev: string, route: string];
/** The 14 default rules, as defaultRules() in lib/engine/rules.ts had them when this was written. */
const RULES: Seed[] = [
  ["acw", "Extended ACW", "duration", "State ACW longer than", "ACW duration", ">", 120, "s", "warn", "nudge"],
  ["auxp", "Unscheduled Aux", "duration", "Aux Personal longer than", "Aux Personal duration", ">", 300, "s", "warn", "nudge"],
  ["ovbrk", "Overbreak", "duration", "Aux Break longer than", "Aux Break duration", ">", 900, "s", "warn", "nudge"],
  ["offl", "Prolonged offline", "duration", "Offline mid-shift longer than", "Offline duration", ">", 600, "s", "crit", "lead"],
  ["long", "Long call", "duration", "On Call longer than", "Call duration", ">", 900, "s", "crit", "lead"],
  ["hold", "Long hold", "duration", "Member on hold longer than", "Hold duration", ">", 120, "s", "warn", "nudge"],
  ["outb", "Outbound call", "duration", "Outbound call longer than", "Outbound call duration", ">", 600, "s", "warn", "lead"],
  ["short", "Short call", "event", "Call released under", "Call duration at release", "<", 30, "s", "warn", "nudge"],
  ["adh", "Adherence breach", "duration", "Shift adherence below", "Shift adherence", "<", 90, "%", "warn", "nudge"],
  ["xfer", "Transfer rate", "ratio", "Transfer rate above (min 5 calls)", "Transfer rate", ">", 25, "%", "warn", "nudge"],
  ["cq", "Queue backlog", "queue", "Calls in queue above", "Calls in queue", ">", 8, "calls", "crit", "lead"],
  ["sl", "Service level", "queue", "Interval SL below", "Service level", "<", 80, "%", "crit", "lead"],
  ["aband", "Abandon rate", "queue", "Interval abandon above", "Abandon rate", ">", 5, "%", "crit", "lead"],
  ["gnr", "Gencloud not responding", "system", "Feed stale longer than", "Feed staleness", ">", 30, "s", "crit", "lead"],
];
const ONCE_PER_SHIFT = new Set(["adh", "xfer"]);

/** Checked in priority order; the first match wins, and no match is Aux Personal. Matches consoleState() in lib/feed/gencloud/state.ts. */
const STATUS_MAPPING = [
  { priority: 10, signal: "presence", genesys_status: "OFFLINE", console_state: "off" },
  { priority: 20, signal: "call", genesys_status: "ACW_NO_CALL", console_state: "acw" },
  { priority: 30, signal: "routing", genesys_status: "INTERACTING", console_state: "oncall" },
  { priority: 40, signal: "routing", genesys_status: "COMMUNICATING", console_state: "outb" },
  { priority: 50, signal: "routing", genesys_status: "IDLE", console_state: "avail" },
  { priority: 60, signal: "routing", genesys_status: "NOT_RESPONDING", console_state: "auxp" },
  { priority: 70, signal: "presence", genesys_status: "BREAK", console_state: "auxb" },
  { priority: 80, signal: "presence", genesys_status: "MEAL", console_state: "auxb" },
  { priority: 90, signal: "presence", genesys_status: "ON_QUEUE", console_state: "avail" },
];

const now = sql`now()`;

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createTable("genesys_region")
    .addColumn("region_id", "text", c => c.primaryKey())
    .addColumn("name", "text", c => c.notNull())
    .addColumn("api_host", "text", c => c.notNull())
    .addColumn("login_host", "text", c => c.notNull())
    .execute();

  await db.schema.createTable("genesys_org")
    .addColumn("org_id", "text", c => c.primaryKey())
    .addColumn("region_id", "text", c => c.notNull().references("genesys_region.region_id"))
    .addColumn("name", "text", c => c.notNull())
    .addColumn("genesys_org_id", "text", c => c.unique())
    .addColumn("view_config_id", "text")
    .addColumn("oauth_client_id", "text")
    .addColumn("enabled", "boolean", c => c.notNull().defaultTo(true))
    .execute();

  await db.schema.createTable("notification_route")
    .addColumn("route_id", "text", c => c.primaryKey())
    .addColumn("route_name", "text", c => c.notNull())
    .addColumn("description", "text")
    .addColumn("enabled", "boolean", c => c.notNull().defaultTo(true))
    .execute();

  await db.schema.createTable("notification_route_step")
    .addColumn("route_id", "text", c => c.notNull().references("notification_route.route_id"))
    .addColumn("step_no", "smallint", c => c.notNull())
    .addColumn("min_occurrence", "smallint", c => c.notNull())
    .addColumn("max_occurrence", "smallint")
    .addColumn("stage", "text", c => c.notNull().check(sql`stage IN ('nudge', 'lead', 'ops')`))
    .addColumn("recipient_roles", sql`text[]`, c => c.notNull())
    .addColumn("action_owner", "text", c => c.notNull())
    .addColumn("action", "text", c => c.notNull())
    .addColumn("channels", sql`text[]`, c => c.notNull())
    .addColumn("opens_incident", "boolean", c => c.notNull().defaultTo(false))
    .addPrimaryKeyConstraint("notification_route_step_pkey", ["route_id", "step_no"])
    .addCheckConstraint("notification_route_step_occurrences", sql`max_occurrence IS NULL OR max_occurrence >= min_occurrence`)
    .execute();

  await db.schema.createTable("rules_master")
    .addColumn("rule_id", "text", c => c.primaryKey())
    .addColumn("rule_name", "text", c => c.notNull())
    .addColumn("description", "text")
    .addColumn("rule_type", "text", c => c.notNull().check(sql`rule_type IN ('duration', 'event', 'ratio', 'queue', 'system')`))
    .addColumn("rule_scope", "text", c => c.notNull().check(sql`rule_scope IN ('agent', 'floor')`))
    .addColumn("metric_name", "text", c => c.notNull())
    .addColumn("operator", "text", c => c.notNull().check(sql`operator IN ('>', '>=', '<', '<=')`))
    .addColumn("once_per_shift", "boolean", c => c.notNull().defaultTo(false))
    .addColumn("nudge_template", "text")
    .addColumn("current_version", "integer", c => c.notNull())
    .addColumn("created_at", "timestamptz", c => c.notNull().defaultTo(now))
    .execute();

  await db.schema.createTable("rule_version")
    .addColumn("rule_id", "text", c => c.notNull().references("rules_master.rule_id"))
    .addColumn("version", "integer", c => c.notNull())
    .addColumn("threshold", "numeric", c => c.notNull().check(sql`threshold >= 1`))
    .addColumn("unit", "text", c => c.notNull())
    .addColumn("severity", "text", c => c.notNull().check(sql`severity IN ('warn', 'crit')`))
    .addColumn("route_id", "text", c => c.notNull().references("notification_route.route_id"))
    .addColumn("enabled", "boolean", c => c.notNull())
    .addColumn("changed_by", "text")
    .addColumn("changed_at", "timestamptz", c => c.notNull().defaultTo(now))
    .addPrimaryKeyConstraint("rule_version_pkey", ["rule_id", "version"])
    .execute();

  // A rule always points at a version that exists. Deferred, so a rule and its first version can be written in either order.
  await db.schema.alterTable("rules_master")
    .addForeignKeyConstraint("rules_master_current_version_fkey", ["rule_id", "current_version"], "rule_version", ["rule_id", "version"], fk => fk.deferrable().initiallyDeferred())
    .execute();

  await db.schema.createTable("status_mapping")
    .addColumn("priority", "smallint", c => c.primaryKey())
    .addColumn("signal", "text", c => c.notNull().check(sql`signal IN ('presence', 'routing', 'call')`))
    .addColumn("genesys_status", "text", c => c.notNull())
    .addColumn("console_state", "text", c => c.notNull().check(sql`console_state IN ('oncall', 'avail', 'acw', 'auxb', 'auxp', 'outb', 'off')`))
    .addColumn("updated_by", "text")
    .addColumn("updated_at", "timestamptz", c => c.notNull().defaultTo(now))
    .addUniqueConstraint("status_mapping_signal_status", ["signal", "genesys_status"])
    .execute();

  await db.schema.createTable("audit_event")
    .addColumn("audit_id", "bigint", c => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn("at", "timestamptz", c => c.notNull().defaultTo(now))
    .addColumn("actor_id", "text")
    .addColumn("action", "text", c => c.notNull())
    .addColumn("target_type", "text", c => c.notNull())
    .addColumn("target_id", "text")
    .addColumn("before", "jsonb")
    .addColumn("after", "jsonb")
    .execute();
  await db.schema.createIndex("audit_event_target").on("audit_event").columns(["target_type", "target_id", "at"]).execute();

  await db.insertInto("genesys_region").values(REGIONS).execute();
  await db.insertInto("genesys_org").values(ORGS).execute();
  await db.insertInto("notification_route").values(ROUTES).execute();
  await db.insertInto("notification_route_step").values(STEPS).execute();
  await db.insertInto("rules_master").values(RULES.map(([rule_id, rule_name, rule_type, description, metric_name, operator]) => ({
    rule_id, rule_name, description, rule_type, metric_name, operator,
    rule_scope: rule_type === "queue" || rule_type === "system" ? "floor" : "agent",
    once_per_shift: ONCE_PER_SHIFT.has(rule_id), current_version: 1,
  }))).execute();
  await db.insertInto("rule_version").values(RULES.map(([rule_id, , , , , , threshold, unit, severity, route_id]) => ({
    rule_id, version: 1, threshold, unit, severity, route_id, enabled: true,
  }))).execute();
  await db.insertInto("status_mapping").values(STATUS_MAPPING).execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const t of ["audit_event", "status_mapping"]) await db.schema.dropTable(t).execute();
  await db.schema.alterTable("rules_master").dropConstraint("rules_master_current_version_fkey").execute();
  for (const t of ["rule_version", "rules_master", "notification_route_step", "notification_route", "genesys_org", "genesys_region"]) await db.schema.dropTable(t).execute();
}
