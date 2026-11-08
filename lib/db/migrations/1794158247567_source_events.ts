import { type Kysely, sql } from "kysely";

// Phase 3: the day's raw Genesys updates, so the day's call counts survive a restart.
//
// - source_event_stream: each update a Genesys floor's feed delivers (agent state and call
//   events, queue numbers, AHT). It only ever holds the current US Eastern day: at midnight Eastern
//   it is emptied with TRUNCATE, for every org at once, so it is not partitioned. An event names
//   its agent or queue (entity_type, entity_id); the Tower, Sub-Tower and LOB are a join, not copied.
// - rtm_app gets TRUNCATE on this one table, where that login exists (the server).
// - audit_event.actor_role: the role the action was taken as. actor_id is the person, and is null
//   for an Admin or Senior Leader, who has no person in the console's view.
//
// monitoring_instance.source_event_id has no foreign key here: the events it points at are emptied
// each night.
// Never edit this once it has run anywhere but a developer's PC: write a new migration.

/* eslint-disable @typescript-eslint/no-explicit-any -- a migration is frozen in time, so it does not use the app's table types */

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createTable("source_event_stream")
    .addColumn("event_id", "bigint", c => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn("org_id", "text", c => c.notNull().references("genesys_org.org_id"))
    .addColumn("event_ts", "timestamptz", c => c.notNull())
    .addColumn("source_system", "text", c => c.notNull().defaultTo("GenCloud").check(sql`source_system IN ('GenCloud', 'NICE', 'UiPath')`))
    .addColumn("entity_type", "text", c => c.notNull().check(sql`entity_type IN ('agent', 'queue', 'team', 'lob', 'system')`))
    .addColumn("entity_id", "text", c => c.notNull())
    // "state", "call.end", "aht", "counts" (one queue), "queue" (the floor's numbers).
    .addColumn("metric_name", "text", c => c.notNull())
    .addColumn("metric_value", "text")
    // The update as the feed delivered it.
    .addColumn("event_payload", "jsonb")
    .execute();
  // Start-up reads one org's call ends for today.
  await db.schema.createIndex("source_event_stream_org_metric").on("source_event_stream").columns(["org_id", "metric_name", "event_ts"]).execute();
  await db.schema.alterTable("audit_event")
    .addColumn("actor_role", "text", c => c.check(sql`actor_role IN ('admin', 'senior', 'mgr', 'tl', 'agent')`))
    .execute();
  await sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rtm_app') THEN
        GRANT TRUNCATE ON source_event_stream TO rtm_app;
      END IF;
    END $$`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("audit_event").dropColumn("actor_role").execute();
  await db.schema.dropTable("source_event_stream").execute();
}
