import { type Kysely, sql } from "kysely";

// Phase 1, step 3: people, queues and the WFM groupings.
//
// - tower → sub_tower → lob: the WFM hierarchy, each row with one parent, filled from the
//   Queue-to-LOB mapping upload. Rows are never deleted, so a rule override (step 4) that points
//   at one keeps its target when a later upload leaves it out.
// - queue_lob_map: the uploaded mapping itself, one row per queue, in upload order. It replaces
//   .rtm/queue-map.json. No foreign key to queue: it can name a queue the feed has not found yet.
// - queue: each Genesys queue the feed watched, keyed by its Genesys queue ID.
// - person: agents and leaders, keyed by Genesys user ID, each with their org, Domain ID,
//   supervisor and LOB. Replaces .rtm/roster.json.
// - queue_member: who is on which queue. A team is a queue, so there is no team table.
// - push_subscription: one row per browser registered for desktop alerts.
// - genesys_org.on_screen: the org the floor shows, which replaces .rtm/genesys-org.
// - rule_version.changed_by and status_mapping.updated_by now point at person.
//
// Never edit this once it has run anywhere but a developer's PC: write a new migration.

/* eslint-disable @typescript-eslint/no-explicit-any -- a migration is frozen in time, so it does not use the app's table types */

const now = sql`now()`;

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createTable("tower")
    .addColumn("tower_id", "integer", c => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn("name", "text", c => c.notNull().unique())
    .addColumn("created_at", "timestamptz", c => c.notNull().defaultTo(now))
    .execute();

  await db.schema.createTable("sub_tower")
    .addColumn("sub_tower_id", "integer", c => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn("tower_id", "integer", c => c.notNull().references("tower.tower_id"))
    .addColumn("name", "text", c => c.notNull())
    .addColumn("created_at", "timestamptz", c => c.notNull().defaultTo(now))
    .addUniqueConstraint("sub_tower_tower_name", ["tower_id", "name"])
    .execute();

  await db.schema.createTable("lob")
    .addColumn("lob_id", "integer", c => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn("sub_tower_id", "integer", c => c.notNull().references("sub_tower.sub_tower_id"))
    .addColumn("name", "text", c => c.notNull())
    .addColumn("created_at", "timestamptz", c => c.notNull().defaultTo(now))
    .addUniqueConstraint("lob_sub_tower_name", ["sub_tower_id", "name"])
    .execute();

  await db.schema.createTable("queue_lob_map")
    // upper(trim(name)), as queueKey() in lib/queueStats.ts: the first row for a queue wins.
    .addColumn("queue_key", "text", c => c.primaryKey())
    .addColumn("queue_name", "text", c => c.notNull())
    .addColumn("lob_id", "integer", c => c.notNull().references("lob.lob_id"))
    .addColumn("region", "text")
    // The Org column as written; org_id is the org it names, null when it is empty (every org) or unknown.
    .addColumn("org_name", "text")
    .addColumn("org_id", "text", c => c.references("genesys_org.org_id"))
    .addColumn("position", "integer", c => c.notNull())
    .addColumn("updated_at", "timestamptz", c => c.notNull().defaultTo(now))
    .execute();

  await db.schema.createTable("queue")
    .addColumn("queue_id", "text", c => c.primaryKey())
    .addColumn("org_id", "text", c => c.notNull().references("genesys_org.org_id"))
    .addColumn("name", "text", c => c.notNull())
    .addColumn("name_key", "text", c => c.notNull())
    // The Genesys division: analytics permissions are granted per division.
    .addColumn("division", "text")
    // Whether the feed watched it last time, and in which order.
    .addColumn("watched", "boolean", c => c.notNull().defaultTo(true))
    .addColumn("position", "integer")
    .addColumn("first_seen", "timestamptz", c => c.notNull().defaultTo(now))
    .addColumn("last_seen", "timestamptz", c => c.notNull().defaultTo(now))
    .execute();
  await db.schema.createIndex("queue_org_name_key").on("queue").columns(["org_id", "name_key"]).execute();

  await db.schema.createTable("person")
    .addColumn("person_id", "text", c => c.primaryKey())
    .addColumn("org_id", "text", c => c.notNull().references("genesys_org.org_id"))
    .addColumn("name", "text", c => c.notNull())
    .addColumn("domain_id", "text")
    // Genesys first, then the CGS directory. An agent's supervisor is their Team Lead, whose supervisor is their Manager.
    .addColumn("supervisor_id", "text")
    // When the reporting lines were last looked up for this person; null when never.
    .addColumn("lines_at", "timestamptz")
    // From the mapping: the LOB with most of their queues, ties by name. Null when none is mapped.
    .addColumn("lob_id", "integer", c => c.references("lob.lob_id"))
    // On the org's last roster; leaders who are on no queue are kept with a null position.
    .addColumn("active", "boolean", c => c.notNull().defaultTo(true))
    .addColumn("roster_pos", "integer")
    // The account's last Genesys login, as the roster last saw it.
    .addColumn("last_login_at", "timestamptz")
    .addColumn("first_seen", "timestamptz", c => c.notNull().defaultTo(now))
    .addColumn("last_seen", "timestamptz", c => c.notNull().defaultTo(now))
    // Deferred, so a roster can be written in any order within its transaction.
    .addForeignKeyConstraint("person_supervisor_fkey", ["supervisor_id"], "person", ["person_id"], fk => fk.deferrable().initiallyDeferred())
    .execute();
  await db.schema.createIndex("person_org").on("person").columns(["org_id", "active"]).execute();
  await db.schema.createIndex("person_supervisor").on("person").column("supervisor_id").execute();
  await db.schema.createIndex("person_domain_id").on("person").column("domain_id").execute();

  await db.schema.createTable("queue_member")
    .addColumn("queue_id", "text", c => c.notNull().references("queue.queue_id").onDelete("cascade"))
    .addColumn("person_id", "text", c => c.notNull().references("person.person_id").onDelete("cascade"))
    // 0 is the agent's home queue (their team).
    .addColumn("position", "smallint", c => c.notNull())
    .addPrimaryKeyConstraint("queue_member_pkey", ["queue_id", "person_id"])
    .execute();
  await db.schema.createIndex("queue_member_person").on("queue_member").column("person_id").execute();

  await db.schema.createTable("push_subscription")
    // sha256 of the endpoint, hex: endpoints are long URLs.
    .addColumn("endpoint_hash", "text", c => c.primaryKey())
    .addColumn("endpoint", "text", c => c.notNull())
    .addColumn("p256dh", "text", c => c.notNull())
    .addColumn("auth", "text", c => c.notNull())
    // Who the browser is signed in as. No foreign key until sign-in: today it is the "View as" person.
    .addColumn("person_id", "text")
    .addColumn("role", "text", c => c.notNull())
    .addColumn("user_agent", "text")
    // The last time the push service accepted an alert for it: old browsers that never take one stand out.
    .addColumn("last_success_at", "timestamptz")
    .addColumn("created_at", "timestamptz", c => c.notNull().defaultTo(now))
    .addColumn("updated_at", "timestamptz", c => c.notNull().defaultTo(now))
    .execute();

  await db.schema.alterTable("genesys_org")
    .addColumn("on_screen", "boolean", c => c.notNull().defaultTo(false))
    .execute();
  await db.schema.createIndex("genesys_org_one_on_screen").on("genesys_org").column("on_screen").unique().where(sql.ref("on_screen"), "=", true).execute();

  await db.schema.alterTable("rule_version")
    .addForeignKeyConstraint("rule_version_changed_by_fkey", ["changed_by"], "person", ["person_id"])
    .execute();
  await db.schema.alterTable("status_mapping")
    .addForeignKeyConstraint("status_mapping_updated_by_fkey", ["updated_by"], "person", ["person_id"])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("status_mapping").dropConstraint("status_mapping_updated_by_fkey").execute();
  await db.schema.alterTable("rule_version").dropConstraint("rule_version_changed_by_fkey").execute();
  await db.schema.dropIndex("genesys_org_one_on_screen").execute();
  await db.schema.alterTable("genesys_org").dropColumn("on_screen").execute();
  for (const t of ["push_subscription", "queue_member", "person", "queue", "queue_lob_map", "lob", "sub_tower", "tower"]) await db.schema.dropTable(t).execute();
}
