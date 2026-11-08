import { type Kysely, sql } from "kysely";

// An investigation's owner: whoever started it. incident_log.owner_id is the person and is null
// for an Admin, who has no person in the console's view, so owner_role keeps the role next to it,
// as audit_event.actor_role does. owner_id, comments and resolution are from the Phase 2 migration.
// Never edit this once it has run anywhere but a developer's PC: write a new migration.

/* eslint-disable @typescript-eslint/no-explicit-any -- a migration is frozen in time, so it does not use the app's table types */

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("incident_log")
    .addColumn("owner_role", "text", c => c.check(sql`owner_role IN ('admin', 'senior', 'mgr', 'tl', 'agent')`))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("incident_log").dropColumn("owner_role").execute();
}
