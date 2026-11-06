import type { Kysely } from "kysely";

// A fifth alert route, "critical", for breaks a LOB Manager should review at once (the
// "Critical Route Example" in RTM Dashboard_Data Tables.docx). Strike 1 goes to the agent and
// their LOB Manager, strike 2 adds the Team Lead, strike 3 and later go to Ops with an incident.
// No rule uses it until someone picks it in the Rules tab.
//
// "mgr" stands for the LOB Manager until Phase 1 links each agent to their own leaders.
// Matches stageFor() and fire() in lib/engine/escalation.ts. Never edit this once it has run
// anywhere but a developer's PC: write a new migration.

/* eslint-disable @typescript-eslint/no-explicit-any -- a migration is frozen in time, so it does not use the app's table types */

const REVIEW = { stage: "lead", action_owner: "mgr", action: "Immediate review", channels: ["popup", "toast", "push"] };

export async function up(db: Kysely<any>): Promise<void> {
  await db.insertInto("notification_route").values({
    route_id: "critical",
    route_name: "Critical: agent + LOB Manager → TL → Ops",
    description: "Strike 1 goes to the agent and their LOB Manager for immediate review, strike 2 adds the Team Lead, strike 3 and later to Ops with an incident.",
  }).execute();
  // Strike 0 is a floor call-out (no agent): it stays on the first rung, so it reaches the LOB Manager.
  await db.insertInto("notification_route_step").values([
    { route_id: "critical", step_no: 1, min_occurrence: 0, max_occurrence: 1, recipient_roles: ["agent", "mgr"], ...REVIEW },
    { route_id: "critical", step_no: 2, min_occurrence: 2, max_occurrence: 2, recipient_roles: ["agent", "tl", "mgr"], ...REVIEW },
    { route_id: "critical", step_no: 3, min_occurrence: 3, max_occurrence: null, stage: "ops", recipient_roles: ["tl", "mgr", "admin", "senior"], action_owner: "mgr", action: "Create incident", channels: ["toast", "push"], opens_incident: true },
  ]).execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.deleteFrom("notification_route_step").where("route_id", "=", "critical").execute();
  await db.deleteFrom("notification_route").where("route_id", "=", "critical").execute();
}
