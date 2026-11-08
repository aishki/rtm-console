import { type Kysely, sql } from "kysely";

// Phase 2: shifts, call-outs, incidents, strikes and deliveries.
//
// - shift: one per org per US Eastern day, midnight to midnight; one active per org. floor_fired
//   lists the queue and system rules in breach, so a restart does not raise them again.
// - agent_rule_state: strikes per shift, agent and rule. A new day has no rows, so strikes start
//   at zero with nothing deleted. Strikes only: the engine's "fired" flags flip too often to keep.
// - monitoring_instance: every call-out. instance_id is the number the console shows; the app
//   hands it out (one counter for every org) and continues from the highest here after a restart.
//   person_id is null on a floor call-out, and occurrence_count (the strike) is then 0.
// - incident_log: one per strike from 3 on, opened by the call-out in instance_id.
// - incident_counter: the last incident number per year (Eastern), shared by every org.
// - notification_log: each desktop alert to each browser, split by month, with a default partition
//   so an insert never fails for want of one.
//
// Only the Genesys floors are saved: CSV replays and the simulator stay in memory.
// Never edit this once it has run anywhere but a developer's PC: write a new migration.

/* eslint-disable @typescript-eslint/no-explicit-any -- a migration is frozen in time, so it does not use the app's table types */

const now = sql`now()`;
/** Months ahead the notification_log partitions are made for, from the month this runs in. */
const MONTHS_AHEAD = 12;

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createTable("shift")
    .addColumn("shift_id", "bigint", c => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn("org_id", "text", c => c.notNull().references("genesys_org.org_id"))
    // The Eastern date; starts_at and ends_at are its midnights.
    .addColumn("shift_date", "date", c => c.notNull())
    .addColumn("starts_at", "timestamptz", c => c.notNull())
    .addColumn("ends_at", "timestamptz", c => c.notNull())
    .addColumn("source", "text", c => c.notNull().defaultTo("gencloud").check(sql`source IN ('gencloud', 'sim')`))
    .addColumn("status", "text", c => c.notNull().defaultTo("active").check(sql`status IN ('active', 'closed')`))
    // Queue and system rules in breach now: "cq", or "cq@" and the group as JSON, ["Tower","Sub-Tower","LOB"].
    .addColumn("floor_fired", sql`text[]`, c => c.notNull().defaultTo(sql`'{}'`))
    .addUniqueConstraint("shift_org_date", ["org_id", "shift_date"])
    .addCheckConstraint("shift_ends_after_start", sql`ends_at > starts_at`)
    .execute();
  await db.schema.createIndex("shift_one_active").on("shift").column("org_id").unique().where(sql.ref("status"), "=", "active").execute();

  await db.schema.createTable("agent_rule_state")
    .addColumn("shift_id", "bigint", c => c.notNull().references("shift.shift_id"))
    .addColumn("person_id", "text", c => c.notNull().references("person.person_id"))
    .addColumn("rule_id", "text", c => c.notNull().references("rules_master.rule_id"))
    .addColumn("strikes", "smallint", c => c.notNull().check(sql`strikes >= 0`))
    .addColumn("updated_at", "timestamptz", c => c.notNull().defaultTo(now))
    .addPrimaryKeyConstraint("agent_rule_state_pkey", ["shift_id", "person_id", "rule_id"])
    .execute();

  await db.schema.createTable("monitoring_instance")
    .addColumn("instance_id", "bigint", c => c.generatedByDefaultAsIdentity().primaryKey())
    .addColumn("shift_id", "bigint", c => c.notNull().references("shift.shift_id"))
    .addColumn("source", "text", c => c.notNull().defaultTo("gencloud").check(sql`source IN ('gencloud', 'sim')`))
    .addColumn("rule_id", "text", c => c.notNull())
    // The rule's version when it fired, and the override that applied, if any (the most specific one).
    .addColumn("rule_version", "integer", c => c.notNull())
    .addColumn("rule_override_id", "bigint", c => c.references("rule_override.override_id"))
    .addColumn("person_id", "text", c => c.references("person.person_id"))
    // Copied at fire time: the agent's team (their home queue), or the group a queue rule was checked for.
    .addColumn("team", "text")
    .addColumn("tower", "text")
    .addColumn("sub_tower", "text")
    .addColumn("lob", "text")
    .addColumn("metric_value", "text", c => c.notNull())
    .addColumn("threshold_value", "numeric", c => c.notNull())
    .addColumn("condition_text", "text", c => c.notNull())
    .addColumn("severity", "text", c => c.notNull().check(sql`severity IN ('warn', 'crit', 'esc')`))
    .addColumn("occurrence_count", "smallint", c => c.notNull())
    .addColumn("notification_level", "text", c => c.notNull().check(sql`notification_level IN ('nudge', 'lead', 'ops')`))
    .addColumn("status", "text", c => c.notNull().defaultTo("open").check(sql`status IN ('open', 'acked')`))
    .addColumn("acknowledged_by", "text", c => c.references("person.person_id"))
    .addColumn("acknowledged_at", "timestamptz")
    .addColumn("ack_via", "text", c => c.check(sql`ack_via IN ('console', 'push', 'ack_all')`))
    .addColumn("agent_comment", "text", c => c.check(sql`char_length(agent_comment) <= 140`))
    .addColumn("agent_comment_at", "timestamptz")
    // No foreign key: duration rules fire from the clock, and the events table is emptied daily.
    .addColumn("source_event_id", "bigint")
    .addColumn("created_at", "timestamptz", c => c.notNull().defaultTo(now))
    .addColumn("updated_at", "timestamptz", c => c.notNull().defaultTo(now))
    .addForeignKeyConstraint("monitoring_instance_rule_version_fkey", ["rule_id", "rule_version"], "rule_version", ["rule_id", "version"])
    .addCheckConstraint("monitoring_instance_strike", sql`(person_id IS NULL AND occurrence_count = 0) OR (person_id IS NOT NULL AND occurrence_count >= 1)`)
    .addCheckConstraint("monitoring_instance_acked", sql`status = 'open' OR acknowledged_at IS NOT NULL`)
    .execute();
  await db.schema.createIndex("monitoring_instance_shift").on("monitoring_instance").column("shift_id").execute();
  await db.schema.createIndex("monitoring_instance_person").on("monitoring_instance").column("person_id").execute();
  await db.schema.createIndex("monitoring_instance_open").on("monitoring_instance").column("instance_id").where(sql.ref("status"), "=", "open").execute();

  await db.schema.createTable("incident_counter")
    .addColumn("year", "smallint", c => c.primaryKey())
    .addColumn("last_value", "integer", c => c.notNull().check(sql`last_value >= 0`))
    .execute();

  await db.schema.createTable("incident_log")
    .addColumn("incident_id", "bigint", c => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn("incident_number", "text", c => c.notNull().unique().check(sql`incident_number ~ '^INC-[0-9]{4}-[0-9]{4,}$'`))
    // The call-out that opened it: one incident per strike from 3 on.
    .addColumn("instance_id", "bigint", c => c.notNull().unique().references("monitoring_instance.instance_id"))
    .addColumn("shift_id", "bigint", c => c.notNull().references("shift.shift_id"))
    .addColumn("source", "text", c => c.notNull().defaultTo("gencloud").check(sql`source IN ('gencloud', 'sim')`))
    .addColumn("person_id", "text", c => c.notNull().references("person.person_id"))
    .addColumn("team", "text")
    .addColumn("rule_id", "text", c => c.notNull().references("rules_master.rule_id"))
    .addColumn("strike", "smallint", c => c.notNull().check(sql`strike >= 3`))
    .addColumn("tower", "text")
    .addColumn("sub_tower", "text")
    .addColumn("lob", "text")
    .addColumn("status", "text", c => c.notNull().defaultTo("Open").check(sql`status IN ('Open', 'Investigating', 'Closed')`))
    // One of the twelve DISPOSITIONS in lib/engine/rules.ts.
    .addColumn("disposition", "text")
    // For the incident-report form (backlog item 7).
    .addColumn("owner_id", "text", c => c.references("person.person_id"))
    .addColumn("priority", "text")
    .addColumn("root_cause", "text")
    .addColumn("resolution", "text")
    .addColumn("comments", "text")
    .addColumn("opened_at", "timestamptz", c => c.notNull().defaultTo(now))
    .addColumn("closed_at", "timestamptz")
    .addColumn("modified_at", "timestamptz", c => c.notNull().defaultTo(now))
    .addCheckConstraint("incident_log_closed", sql`status <> 'Closed' OR (closed_at IS NOT NULL AND disposition IS NOT NULL AND disposition <> 'Pending Investigation')`)
    .execute();
  await db.schema.createIndex("incident_log_open").on("incident_log").column("status").where(sql.ref("status"), "<>", "Closed").execute();

  // Partitioned by month on notification_ts, so its primary key includes it.
  await sql`
    CREATE TABLE notification_log (
      notification_log_id bigint GENERATED ALWAYS AS IDENTITY,
      notification_ts     timestamptz NOT NULL DEFAULT now(),
      instance_id         bigint REFERENCES monitoring_instance (instance_id),
      recipient_id        text REFERENCES person (person_id),
      recipient_role      text NOT NULL CHECK (recipient_role IN ('admin', 'senior', 'mgr', 'tl', 'agent')),
      channel             text NOT NULL CHECK (channel IN ('popup', 'toast', 'preview', 'push', 'email', 'teams')),
      notification_level  text NOT NULL CHECK (notification_level IN ('nudge', 'lead', 'ops', 'info')),
      endpoint_hash       text REFERENCES push_subscription (endpoint_hash) ON DELETE SET NULL,
      delivery_status     text NOT NULL CHECK (delivery_status IN ('sent', 'shown', 'delivered', 'expired', 'gone', 'failed')),
      action              text CHECK (action IN ('got_it', 'send_reason', 'acknowledge')),
      action_at           timestamptz,
      PRIMARY KEY (notification_log_id, notification_ts)
    ) PARTITION BY RANGE (notification_ts)`.execute(db);
  await sql`CREATE TABLE notification_log_default PARTITION OF notification_log DEFAULT`.execute(db);
  const start = new Date();
  for (let i = 0; i <= MONTHS_AHEAD; i++) {
    const from = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const to = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i + 1, 1));
    const name = `notification_log_${from.getUTCFullYear()}_${String(from.getUTCMonth() + 1).padStart(2, "0")}`;
    // Month bounds in UTC: a row near midnight on the 1st lands in the month it is in, in UTC.
    await sql`CREATE TABLE ${sql.id(name)} PARTITION OF notification_log FOR VALUES FROM (${sql.lit(from.toISOString())}) TO (${sql.lit(to.toISOString())})`.execute(db);
  }
  await sql`CREATE INDEX notification_log_instance ON notification_log (instance_id)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const t of ["notification_log", "incident_log", "incident_counter", "monitoring_instance", "agent_rule_state", "shift"]) await db.schema.dropTable(t).execute();
}
