import { type Kysely, sql } from "kysely";

// Phase 1, step 4: a rule's settings for one Tower, Sub-Tower or LOB.
//
// - rule_override: one row per version of one rule's settings for one place. The place is exactly
//   one of tower_id, sub_tower_id or lob_id, so a rename in the mapping does not detach it.
//   Each setting left null takes the value from the level above (LOB, then Sub-Tower, then Tower,
//   then the rule's own version in rule_version). A version with every setting null removes the
//   override. The highest version per rule and place is the current one.
// - The unit is the rule's: an override cannot change seconds into percent.
// - System rules (Gencloud not responding) take no override; the app refuses one.
//
// Never edit this once it has run anywhere but a developer's PC: write a new migration.

/* eslint-disable @typescript-eslint/no-explicit-any -- a migration is frozen in time, so it does not use the app's table types */

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createTable("rule_override")
    .addColumn("override_id", "bigint", c => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn("rule_id", "text", c => c.notNull().references("rules_master.rule_id"))
    .addColumn("tower_id", "integer", c => c.references("tower.tower_id"))
    .addColumn("sub_tower_id", "integer", c => c.references("sub_tower.sub_tower_id"))
    .addColumn("lob_id", "integer", c => c.references("lob.lob_id"))
    .addColumn("scope_level", "text", c => c.notNull().generatedAlwaysAs(sql`CASE WHEN lob_id IS NOT NULL THEN 'lob' WHEN sub_tower_id IS NOT NULL THEN 'sub_tower' ELSE 'tower' END`).stored())
    .addColumn("version", "integer", c => c.notNull().check(sql`version >= 1`))
    .addColumn("threshold", "numeric", c => c.check(sql`threshold >= 1`))
    .addColumn("severity", "text", c => c.check(sql`severity IN ('warn', 'crit')`))
    .addColumn("route_id", "text", c => c.references("notification_route.route_id"))
    .addColumn("enabled", "boolean")
    .addColumn("changed_by", "text", c => c.references("person.person_id"))
    .addColumn("changed_at", "timestamptz", c => c.notNull().defaultTo(sql`now()`))
    .addColumn("change_reason", "text")
    .addCheckConstraint("rule_override_one_place", sql`num_nonnulls(tower_id, sub_tower_id, lob_id) = 1`)
    .execute();
  // One row per version per rule and place; the place is whichever of the three is set.
  for (const col of ["tower_id", "sub_tower_id", "lob_id"]) {
    await db.schema.createIndex(`rule_override_${col.replace("_id", "")}_version`).on("rule_override").columns(["rule_id", col, "version"]).unique().where(sql.ref(col), "is not", null).execute();
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("rule_override").execute();
}
