import { createHash } from "node:crypto";
import { type Kysely, type Transaction, sql } from "kysely";
import type { DB } from "@/lib/db/schema";
import type { IncidentSeq } from "@/lib/engine/escalation";
import type { AckVia, SavedFloor } from "@/lib/engine/record";
import { defaultRules } from "@/lib/engine/rules";
import { FLOOR_TIME_ZONE, floorSeconds } from "@/lib/floorTime";
import type { OrgId } from "@/lib/orgs";
import type { Incident, Instance, InvAction, Place, Role, RuleId, Severity, Stage, View } from "@/lib/types";
import type { FiredInfo, NotificationSent } from "./store";

// Phase 2: a Genesys floor's shifts, call-outs, incidents, strikes and desktop-alert deliveries,
// written through the store's queue and read back at start-up.

export const hashOf = (endpoint: string): string => createHash("sha256").update(endpoint).digest("hex");
/** A floor date (YYYY-MM-DD) as a date for a query. */
const day = (d: string) => sql<Date>`${d}::date`;
const ruleName = new Map(defaultRules().map(r => [r.id, r.name]));

/**
 * The org's shift for `date`, made when missing. A new day's shift closes the one before, so each
 * org has one active shift; a late write for an earlier day gets its own row, closed.
 */
export async function shiftFor(tx: Transaction<DB>, org: OrgId, date: string): Promise<string> {
  const known = await tx.selectFrom("shift").select("shift_id").where("org_id", "=", org).where("shift_date", "=", day(date)).executeTakeFirst();
  if (known) return known.shift_id;
  const later = await tx.selectFrom("shift").select("shift_id").where("org_id", "=", org).where("status", "=", "active").where("shift_date", ">", day(date)).executeTakeFirst();
  if (!later) await tx.updateTable("shift").set({ status: "closed" }).where("org_id", "=", org).where("status", "=", "active").execute();
  const row = await tx.insertInto("shift").values({
    org_id: org, shift_date: date,
    // The floor's midnights, across daylight-saving changes.
    starts_at: sql<Date>`${date}::date::timestamp AT TIME ZONE ${FLOOR_TIME_ZONE}`,
    ends_at: sql<Date>`(${date}::date + 1)::timestamp AT TIME ZONE ${FLOOR_TIME_ZONE}`,
    status: later ? "closed" : "active",
  }).returning("shift_id").executeTakeFirstOrThrow();
  return row.shift_id;
}

/** A person row for an agent the roster has not saved yet, so a call-out about them can point at it. */
async function personFor(tx: Transaction<DB>, org: OrgId, uid: string, name: string): Promise<void> {
  await tx.insertInto("person").values({ person_id: uid, org_id: org, name, roster_pos: null }).onConflict(oc => oc.column("person_id").doNothing()).execute();
}

/** `uid` when they have a person row, else null: an admin's view has no person, and the foreign key would refuse it. */
export const personOrNull = (uid: string | null | undefined) => (uid ? sql<string | null>`(SELECT person_id FROM person WHERE person_id = ${uid})` : null);

/** The current version of the override at `place`, when it still sets something. Nothing is made: the override was saved before it applied. */
async function overrideId(tx: Transaction<DB>, ruleId: RuleId, p: Place): Promise<string | null> {
  const t = await tx.selectFrom("tower").select("tower_id").where("name", "=", p.tower).executeTakeFirst();
  if (!t) return null;
  let col: "tower_id" | "sub_tower_id" | "lob_id" = "tower_id", id = t.tower_id;
  if (p.subTower) {
    const s = await tx.selectFrom("sub_tower").select("sub_tower_id").where("tower_id", "=", t.tower_id).where("name", "=", p.subTower).executeTakeFirst();
    if (!s) return null;
    col = "sub_tower_id"; id = s.sub_tower_id;
    if (p.lob) {
      const l = await tx.selectFrom("lob").select("lob_id").where("sub_tower_id", "=", s.sub_tower_id).where("name", "=", p.lob).executeTakeFirst();
      if (!l) return null;
      col = "lob_id"; id = l.lob_id;
    }
  }
  const o = await tx.selectFrom("rule_override").select(["override_id", "threshold", "severity", "route_id", "enabled"])
    .where("rule_id", "=", ruleId).where(col, "=", id).orderBy("version", "desc").limit(1).executeTakeFirst();
  return o && (o.threshold !== null || o.severity !== null || o.route_id !== null || o.enabled !== null) ? o.override_id : null;
}

/** INC-2026-0042 as year 2026, number 42. */
const counterOf = (inc: string): IncidentSeq | null => {
  const m = /^INC-(\d{4})-(\d+)$/.exec(inc);
  return m ? { year: Number(m[1]), n: Number(m[2]) } : null;
};

/**
 * A call-out, in one transaction with the strike it counted and the incident it opened, so neither
 * exists without the other. Its ID is the number the console shows.
 */
export async function writeFired(tx: Transaction<DB>, org: OrgId, date: string, rec: Instance, x: FiredInfo): Promise<void> {
  const shiftId = await shiftFor(tx, org, date);
  if (rec.agentId) await personFor(tx, org, rec.agentId, rec.agent);
  const { current_version } = await tx.selectFrom("rules_master").select("current_version").where("rule_id", "=", rec.ruleId).executeTakeFirstOrThrow();
  const p = rec.place;
  await tx.insertInto("monitoring_instance").values({
    instance_id: rec.n, shift_id: shiftId, rule_id: rec.ruleId, rule_version: current_version,
    rule_override_id: x.overrideAt ? await overrideId(tx, rec.ruleId, x.overrideAt) : null,
    person_id: rec.agentId, team: rec.team, tower: p?.tower || null, sub_tower: p?.subTower || null, lob: p?.lob || null,
    metric_value: rec.val, threshold_value: x.thr, condition_text: rec.cond, severity: rec.sev,
    occurrence_count: rec.strikes, notification_level: rec.stage, created_at: x.at, updated_at: x.at,
  }).execute();
  if (rec.agentId) {
    await tx.insertInto("agent_rule_state").values({ shift_id: shiftId, person_id: rec.agentId, rule_id: rec.ruleId, strikes: rec.strikes })
      .onConflict(oc => oc.columns(["shift_id", "person_id", "rule_id"]).doUpdateSet({
        strikes: sql<number>`greatest(agent_rule_state.strikes, excluded.strikes)`, updated_at: sql`now()`,
      })).execute();
  }
  const i = x.incident;
  if (i && rec.agentId) {
    await tx.insertInto("incident_log").values({
      incident_number: i.inc, instance_id: rec.n, shift_id: shiftId, person_id: rec.agentId, team: rec.team, rule_id: rec.ruleId,
      strike: i.instances, tower: p?.tower || null, sub_tower: p?.subTower || null, lob: p?.lob || null,
      status: i.status, opened_at: x.at, modified_at: x.at,
    }).execute();
    const c = counterOf(i.inc);
    if (c) {
      await tx.insertInto("incident_counter").values({ year: c.year, last_value: c.n })
        .onConflict(oc => oc.column("year").doUpdateSet({ last_value: sql<number>`greatest(incident_counter.last_value, excluded.last_value)` })).execute();
    }
  }
}

/** audit_event's actor columns for `by`. actor_id has no foreign key, so it keeps a uid that has no person row. */
export const actor = (by: View | null | undefined) => ({ actor_id: by?.who ?? null, actor_role: by?.role ?? null });

export async function writeAcked(tx: Transaction<DB>, ns: number[], by: View | null, via: AckVia, at: Date): Promise<void> {
  const done = await tx.updateTable("monitoring_instance")
    .set({ status: "acked", acknowledged_at: at, acknowledged_by: personOrNull(by?.who), ack_via: via, updated_at: sql`now()` })
    .where("instance_id", "in", ns.map(String)).where("status", "=", "open").returning("instance_id").execute();
  if (via !== "ack_all") return;
  await tx.insertInto("audit_event").values({
    at, ...actor(by), action: "monitoring_instance.ack_all", target_type: "monitoring_instance", target_id: null,
    before: null, after: JSON.stringify({ count: done.length, instances: done.map(d => Number(d.instance_id)) }),
  }).execute();
}

export async function writeComment(tx: Transaction<DB>, n: number, text: string, at: Date): Promise<void> {
  await tx.updateTable("monitoring_instance").set({ agent_comment: text, agent_comment_at: at, updated_at: sql`now()` }).where("instance_id", "=", String(n)).execute();
}

export async function writeIncidentMove(tx: Transaction<DB>, i: Incident, action: InvAction, by: View | null, at: Date): Promise<void> {
  const was = await tx.selectFrom("incident_log").select(["status", "disposition", "owner_id", "owner_role", "comments", "resolution"])
    .where("incident_number", "=", i.inc).forUpdate().executeTakeFirst();
  if (!was) return; // opened before the floor was saved
  const next = {
    status: i.status, disposition: i.disposition || null, owner_id: i.owner?.who ?? null, owner_role: i.owner?.role ?? null,
    comments: i.comments || null, resolution: i.resolution || null,
  };
  // The audit entry keeps the owner as given; the row names them only when they have a person row.
  await tx.updateTable("incident_log").set({ ...next, owner_id: personOrNull(next.owner_id), closed_at: i.status === "Closed" ? at : null, modified_at: at })
    .where("incident_number", "=", i.inc).execute();
  await tx.insertInto("audit_event").values({
    at, ...actor(by), action: `incident.${action}`, target_type: "incident_log", target_id: i.inc,
    before: JSON.stringify(was), after: JSON.stringify(next),
  }).execute();
}

export async function writeFloorFired(tx: Transaction<DB>, org: OrgId, date: string, keys: string[]): Promise<void> {
  const shiftId = await shiftFor(tx, org, date);
  await tx.updateTable("shift").set({ floor_fired: keys }).where("shift_id", "=", shiftId).execute();
}

/**
 * Desktop alerts as sent. A call-out, person or browser that has no row (yet, or any more) is left
 * out of its row rather than refusing the whole write.
 */
export async function writeNotifications(tx: Transaction<DB>, rows: NotificationSent[]): Promise<void> {
  if (!rows.length) return;
  const ns = [...new Set(rows.flatMap(r => (r.n === null ? [] : [r.n])))];
  const who = [...new Set(rows.flatMap(r => (r.who === null ? [] : [r.who])))];
  const hashes = [...new Set(rows.map(r => hashOf(r.endpoint)))];
  const knownN = new Set(ns.length ? (await tx.selectFrom("monitoring_instance").select("instance_id").where("instance_id", "in", ns.map(String)).execute()).map(r => Number(r.instance_id)) : []);
  const knownWho = new Set(who.length ? (await tx.selectFrom("person").select("person_id").where("person_id", "in", who).execute()).map(r => r.person_id) : []);
  const knownHash = new Set((await tx.selectFrom("push_subscription").select("endpoint_hash").where("endpoint_hash", "in", hashes).execute()).map(r => r.endpoint_hash));
  await tx.insertInto("notification_log").values(rows.map(r => {
    const h = hashOf(r.endpoint);
    return {
      notification_ts: r.at, instance_id: r.n !== null && knownN.has(r.n) ? r.n : null,
      recipient_id: r.who !== null && knownWho.has(r.who) ? r.who : null, recipient_role: r.role,
      channel: "push", notification_level: r.level, endpoint_hash: knownHash.has(h) ? h : null, delivery_status: r.status,
    };
  })).execute();
}

/**
 * Each org's floor to carry on from on `today`: today's call-outs and every open one, today's
 * incidents and every one not closed, today's strikes and the rules in breach.
 */
export async function readFloors(db: Kysely<DB>, today: string): Promise<Partial<Record<OrgId, SavedFloor>>> {
  const out: Partial<Record<OrgId, SavedFloor>> = {};
  const shifts = await db.selectFrom("shift").select(["shift_id", "org_id", "floor_fired"]).where("shift_date", "=", day(today)).execute();

  const calls = await db.selectFrom("monitoring_instance as mi").innerJoin("shift as s", "s.shift_id", "mi.shift_id")
    .leftJoin("person as p", "p.person_id", "mi.person_id").leftJoin("incident_log as il", "il.instance_id", "mi.instance_id")
    .select(["s.org_id", "mi.instance_id", "mi.rule_id", "mi.person_id", "p.name", "mi.team", "mi.tower", "mi.sub_tower", "mi.lob", "mi.metric_value",
      "mi.condition_text", "mi.severity", "mi.occurrence_count", "mi.notification_level", "mi.status", "mi.acknowledged_at", "mi.agent_comment", "mi.created_at", "il.incident_number"])
    .where(eb => eb.or([eb("s.shift_date", "=", day(today)), eb("mi.status", "=", "open")]))
    .orderBy("mi.instance_id", "desc").execute();

  const incidents = await db.selectFrom("incident_log as il").innerJoin("shift as s", "s.shift_id", "il.shift_id").leftJoin("person as p", "p.person_id", "il.person_id")
    .leftJoin("person as o", "o.person_id", "il.owner_id")
    .select(["s.org_id", "il.incident_number", "il.person_id", "p.name", "il.team", "il.rule_id", "il.strike", "il.status", "il.disposition", "il.opened_at", "il.closed_at",
      "il.owner_id", "il.owner_role", "o.name as owner_name", "il.comments", "il.resolution"])
    .where(eb => eb.or([eb("s.shift_date", "=", day(today)), eb("il.status", "<>", "Closed")]))
    .orderBy("il.incident_id", "desc").execute();

  const strikes = shifts.length ? await db.selectFrom("agent_rule_state").select(["shift_id", "person_id", "rule_id", "strikes"]).where("shift_id", "in", shifts.map(s => s.shift_id)).execute() : [];

  const floor = (org: string): SavedFloor => (out[org as OrgId] ??= { date: today, ledger: [], incidents: [], strikes: {}, floorFired: [] });
  for (const s of shifts) floor(s.org_id).floorFired = s.floor_fired;
  for (const c of calls) {
    const ruleId = c.rule_id as RuleId;
    floor(c.org_id).ledger.push({
      n: Number(c.instance_id), t: floorSeconds(c.created_at),
      agent: c.person_id ? c.name ?? c.person_id : "Queue", agentId: c.person_id, isFloor: !c.person_id, team: c.team ?? "Floor",
      ...(c.tower && { place: { tower: c.tower, subTower: c.sub_tower ?? "", lob: c.lob ?? "" } }),
      rule: ruleName.get(ruleId) ?? ruleId, ruleId, val: c.metric_value, stage: c.notification_level as Stage, sev: c.severity as Severity | "esc",
      status: c.status as Instance["status"], ackT: c.acknowledged_at ? floorSeconds(c.acknowledged_at) : null,
      strikes: c.occurrence_count, inc: c.incident_number ?? "", cmt: c.agent_comment, cond: c.condition_text, rev: 0,
    });
  }
  for (const i of incidents) {
    const ruleId = i.rule_id as RuleId;
    floor(i.org_id).incidents.push({
      inc: i.incident_number, t: floorSeconds(i.opened_at), agent: i.name ?? i.person_id, agentId: i.person_id, team: i.team ?? "",
      rule: ruleName.get(ruleId) ?? ruleId, ruleId, instances: i.strike, status: i.status as Incident["status"],
      disposition: i.disposition ?? "", closedT: i.closed_at ? floorSeconds(i.closed_at) : null,
      ...(i.owner_role && { owner: { who: i.owner_id, role: i.owner_role as Role, name: i.owner_name } }),
      ...(i.comments && { comments: i.comments }), ...(i.resolution && { resolution: i.resolution }),
    });
  }
  const orgOfShift = new Map(shifts.map(s => [s.shift_id, s.org_id]));
  for (const k of strikes) {
    const f = floor(orgOfShift.get(k.shift_id)!);
    (f.strikes[k.person_id] ??= {})[k.rule_id as RuleId] = k.strikes;
  }
  return out;
}

/** The highest call-out number saved, and the incident counter for the latest year. */
export async function readCounters(db: Kysely<DB>): Promise<{ lastInstance: number; incidentSeq: IncidentSeq | null }> {
  const top = await db.selectFrom("monitoring_instance").select(sql<string | null>`max(instance_id)`.as("n")).executeTakeFirstOrThrow();
  const c = await db.selectFrom("incident_counter").select(["year", "last_value"]).orderBy("year", "desc").limit(1).executeTakeFirst();
  return { lastInstance: Number(top.n ?? 0), incidentSeq: c ? { year: c.year, n: c.last_value } : null };
}
