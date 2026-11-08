import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { type Kysely, sql } from "kysely";
import { type Migration, type MigrationProvider, Migrator, NO_MIGRATIONS } from "kysely/migration";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@/lib/db/client";
import { ensureNotificationPartitions } from "@/lib/db/partitions";
import type { DB } from "@/lib/db/schema";
import { databaseUrl, isTestDatabase, testDatabaseUrl } from "@/lib/db/url";
import { ROUTE_IDS, defaultRules } from "@/lib/engine/rules";
import { consoleState, mapGenesysState } from "@/lib/feed/gencloud/state";
import { ORGS } from "@/lib/orgs";
import { floorDate, floorMidnight } from "@/lib/floorTime";
import type { Incident, Instance } from "@/lib/types";
import type { QueueMapRow } from "@/lib/import/queueMap";
import { createEngine } from "@/lib/engine/engine";
import { incidentCounter, stageFor } from "@/lib/engine/escalation";
import type { Recorder } from "@/lib/engine/record";
import type { FeedHandlers } from "@/lib/feed/FeedSource";
import { recordingEvents } from "@/lib/feed/recordingEvents";
import type { OrgId } from "@/lib/orgs";
import { postgresStore } from "./postgres";
import type { RosterNames, SourceEvent, Store } from "./store";

// Migrations and the PostgreSQL store against a real database. Skipped unless a database is
// configured (TEST_DATABASE_URL, DATABASE_URL or DB_*), and refused unless it is a *_test one,
// because each run empties it. With the local container: npm run db:up, then set the DB_* values.

const e = process.env;
const mainUrl = e.DATABASE_URL ?? (e.DB_HOST && e.DB_NAME && e.DB_USER && e.DB_PASSWORD !== undefined
  ? databaseUrl({ DB_HOST: e.DB_HOST, DB_PORT: Number(e.DB_PORT ?? 5432), DB_NAME: e.DB_NAME, DB_USER: e.DB_USER, DB_PASSWORD: e.DB_PASSWORD })
  : undefined);
const url = e.TEST_DATABASE_URL ?? (mainUrl ? testDatabaseUrl(mainUrl) : undefined);
const sslMode = (e.DB_SSLMODE ?? "disable") as "verify-full" | "no-verify" | "disable";

describe.skipIf(!url)("PostgreSQL: migrations and the store", () => {
  let db: Kysely<DB>;
  const folder = path.join(__dirname, "../db/migrations");
  // Kysely's FileMigrationProvider imports a bare path, which Windows refuses (C: is read as a URL scheme).
  const provider: MigrationProvider = {
    async getMigrations() {
      const files = (await fs.readdir(folder)).filter(f => f.endsWith(".ts")).sort();
      return Object.fromEntries(await Promise.all(files.map(async f => [f.replace(/\.ts$/, ""), (await import(pathToFileURL(path.join(folder, f)).href)) as Migration] as const)));
    },
  };
  const migrator = () => new Migrator({ db, provider });

  beforeAll(async () => {
    if (!isTestDatabase(url!)) throw new Error("Refusing to run: the integration tests empty their database, and this one is not named *_test.");
    db = createDb({ DB_SSLMODE: sslMode, DB_POOL_MAX: 2 }, url);
    await sql`DROP SCHEMA IF EXISTS public CASCADE`.execute(db);
    await sql`CREATE SCHEMA public`.execute(db);
  });
  afterAll(async () => { await db?.destroy(); });

  it("migrates an empty database, and a second run does nothing", async () => {
    const first = await migrator().migrateToLatest();
    expect(first.error).toBeUndefined();
    expect(first.results?.map(r => r.status)).toEqual(["Success", "Success", "Success", "Success", "Success", "Success", "Success"]);
    const second = await migrator().migrateToLatest();
    expect(second.error).toBeUndefined();
    expect(second.results).toEqual([]);
  });

  it("writes the reference data", async () => {
    const count = async (t: keyof DB) => Number((await db.selectFrom(t).select(sql<string>`count(*)`.as("n")).executeTakeFirstOrThrow()).n);
    expect(await count("genesys_region")).toBe(2);
    expect(await count("genesys_org")).toBe(3);
    expect(await count("notification_route")).toBe(5);
    expect(await count("notification_route_step")).toBe(10);
    expect(await count("rules_master")).toBe(14);
    expect(await count("rule_version")).toBe(14);
    expect(await count("status_mapping")).toBe(9);
  });

  it("holds the same alert ladders, state mapping and regions as the code, which does not read them", async () => {
    // Each route's rung for strikes 0 (a floor call-out) to 5 is the engine's stage, and only Ops opens an incident.
    const steps = await db.selectFrom("notification_route_step").select(["route_id", "min_occurrence", "max_occurrence", "stage", "opens_incident"]).execute();
    for (const route of ROUTE_IDS) {
      for (let strike = 0; strike <= 5; strike++) {
        const at = steps.filter(r => r.route_id === route && r.min_occurrence <= strike && (r.max_occurrence === null || r.max_occurrence >= strike));
        expect(at.map(r => [r.stage, r.opens_incident]), `${route}, strike ${strike}`).toEqual([[stageFor(route, strike), stageFor(route, strike) === "ops"]]);
      }
    }
    // Each Genesys status maps to the console state the feed gives it.
    const map = await db.selectFrom("status_mapping").select(["signal", "genesys_status", "console_state"]).orderBy("priority").execute();
    for (const m of map) {
      const got = m.signal === "presence" ? mapGenesysState(m.genesys_status, undefined)
        : m.signal === "routing" ? mapGenesysState("Away", m.genesys_status)
        : consoleState("On Queue", "INTERACTING", { onCall: false, acwSince: 1 });
      expect(got, `${m.signal} ${m.genesys_status}`).toBe(m.console_state);
    }
    // Each org's region is where the feed calls it.
    const orgs = await db.selectFrom("genesys_org as o").innerJoin("genesys_region as r", "r.region_id", "o.region_id").select(["o.org_id", "r.api_host"]).execute();
    expect(Object.fromEntries(orgs.map(o => [o.org_id, `https://${o.api_host}`]))).toEqual(Object.fromEntries(ORGS.map(o => [o.id, o.apiBase])));
  });

  it("loads the rules as the code's defaults", async () => {
    expect(await postgresStore(db).loadRules()).toEqual(defaultRules());
  });

  it("keeps an edited threshold across a restart, with the old value as an earlier version", async () => {
    const store = postgresStore(db, { foldMs: 20 });
    const rules = await store.loadRules();
    const acw = rules.find(r => r.id === "acw")!;
    acw.thr = 150; store.ruleChanged(acw);
    acw.thr = 180; store.ruleChanged(acw); // typed in quick succession: one version
    await store.flush();

    const reloaded = await postgresStore(db).loadRules(); // a fresh store, as after a restart
    expect(reloaded.find(r => r.id === "acw")!.thr).toBe(180);
    const versions = await db.selectFrom("rule_version").select(["version", "threshold"]).where("rule_id", "=", "acw").orderBy("version").execute();
    expect(versions.map(v => [v.version, Number(v.threshold)])).toEqual([[1, 120], [2, 180]]);
    const master = await db.selectFrom("rules_master").select("current_version").where("rule_id", "=", "acw").executeTakeFirstOrThrow();
    expect(master.current_version).toBe(2);
  });

  it("keeps edits by different people apart, and skips a change that was undone", async () => {
    const store = postgresStore(db, { foldMs: 20 });
    // changed_by points at person, so the editors must be people.
    await db.insertInto("person").values([{ person_id: "a", org_id: "commercial", name: "Editor A" }, { person_id: "b", org_id: "commercial", name: "Editor B" }]).execute();
    const sl = (await store.loadRules()).find(r => r.id === "sl")!;
    sl.thr = 85; store.ruleChanged(sl, { role: "mgr", who: "a" });
    sl.thr = 90; store.ruleChanged(sl, { role: "mgr", who: "b" });
    await store.flush();
    const auxp = (await store.loadRules()).find(r => r.id === "auxp")!;
    auxp.on = false; store.ruleChanged(auxp);
    auxp.on = true; store.ruleChanged(auxp);
    await store.flush();
    const rows = await db.selectFrom("rule_version").select(["rule_id", "version", "threshold", "changed_by"]).where("rule_id", "in", ["sl", "auxp"]).orderBy("rule_id").orderBy("version").execute();
    expect(rows.map(r => [r.rule_id, r.version, Number(r.threshold), r.changed_by])).toEqual([
      ["auxp", 1, 300, null], ["sl", 1, 80, null], ["sl", 2, 85, "a"], ["sl", 3, 90, "b"],
    ]);
    // Each new version has an audit entry with who made it and as what role, and what it was before.
    const audit = await db.selectFrom("audit_event").select(["actor_id", "actor_role", "target_id", "before", "after"]).where("action", "=", "rule.change").orderBy("audit_id").execute();
    expect(audit.map(a => [a.actor_id, a.actor_role, a.target_id, (a.before as { threshold: number }).threshold, (a.after as { threshold: number }).threshold]))
      .toEqual([[null, null, "acw", 120, 180], ["a", "mgr", "sl", 80, 85], ["b", "mgr", "sl", 85, 90]]);
  });

  it("keeps an admin's rule edit with the role, and a switch of the floor", async () => {
    const store = postgresStore(db, { foldMs: 20, importDir: null });
    const ab = (await store.loadRules()).find(r => r.id === "aband")!;
    ab.thr += 1; store.ruleChanged(ab, { role: "admin", who: null });
    store.feedSwitched({ source: "gencloud", org: "commercial" }, { source: "gencloud", org: "gbd" }, { role: "admin", who: null }, new Date());
    store.feedSwitched({ source: "gencloud", org: "gbd" }, { source: "sim", org: "gbd" }, { role: "senior", who: null }, new Date());
    await store.flush();
    const audit = await db.selectFrom("audit_event").select(["action", "actor_id", "actor_role", "target_id", "after"]).where("action", "in", ["rule.change", "feed.switch"]).where("actor_role", "in", ["admin", "senior"]).orderBy("audit_id").execute();
    expect(audit).toEqual([
      { action: "rule.change", actor_id: null, actor_role: "admin", target_id: "aband", after: expect.objectContaining({ threshold: ab.thr }) },
      { action: "feed.switch", actor_id: null, actor_role: "admin", target_id: "gbd", after: { source: "gencloud", org: "gbd" } },
      { action: "feed.switch", actor_id: null, actor_role: "senior", target_id: "sim", after: { source: "sim", org: "gbd" } },
    ]);
  });

  // ---- Phase 1: the queue map, people, queues, subscriptions and the org on screen ----

  const MAP: QueueMapRow[] = [
    { tower: "Provider", subTower: "Claims", lob: "Local", queue: "Q_LOCAL_1" },
    { tower: "Provider", subTower: "Claims", lob: "Local", queue: "Q_LOCAL_2" },
    { tower: "Provider", subTower: "Claims", lob: "Host", queue: "Q_HOST", region: "East" },
    { tower: "Member", subTower: "Care", lob: "Horizon", queue: "Q_GBD", org: "Anthem GBD" },
  ];
  const ROSTER: RosterNames = {
    org: ["Q_LOCAL_1", "Q_LOCAL_2", "Q_HOST"].map(team => ({ team, tl: "", mgr: "", lob: team })),
    queues: [{ id: "q1", name: "Q_LOCAL_1", division: "Claims" }, { id: "q2", name: "Q_LOCAL_2" }, { id: "q3", name: "Q_HOST" }],
    agents: [
      { uid: "a1", name: "Agent One - AB12345", team: "Q_HOST", lastLogin: "2026-11-08T13:00:00.000Z" },
      { uid: "a2", name: "Agent Two - CD67890", team: "Q_LOCAL_1" },
    ],
    members: { Q_LOCAL_1: ["a1", "a2"], Q_LOCAL_2: ["a1"], Q_HOST: ["a1"] },
    people: [
      { uid: "a1", name: "Agent One - AB12345", supervisor: "tl1" },
      { uid: "a2", name: "Agent Two - CD67890", supervisor: "gone" },
      { uid: "tl1", name: "Lead One - EF11111", supervisor: "m1" },
      { uid: "m1", name: "Manager One - GH22222", supervisor: null },
    ],
  };

  it("imports the queue map file once, while its table is empty", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rtm-import-"));
    await fs.writeFile(path.join(dir, "queue-map.json"), JSON.stringify(MAP));
    await fs.writeFile(path.join(dir, "genesys-org"), "gbd");
    const boot = await postgresStore(db, { importDir: dir, log: () => {} }).loadBoot();
    expect(boot.queueMap).toEqual(MAP);
    expect(boot.activeOrg).toBe("gbd");
    await fs.writeFile(path.join(dir, "queue-map.json"), JSON.stringify(MAP.slice(0, 1)));
    expect((await postgresStore(db, { importDir: dir }).loadBoot()).queueMap).toEqual(MAP);
    const audit = await db.selectFrom("audit_event").select("action").where("target_type", "=", "queue_lob_map").execute();
    expect(audit.map(a => a.action)).toEqual(["queue_lob_map.import"]);
  });

  it("saves the queue map with its hierarchy, and an upload keeps the old towers' rows", async () => {
    const store = postgresStore(db, { importDir: null });
    await store.saveQueueMap(MAP.slice(2), { role: "admin", who: null });
    expect((await store.loadBoot()).queueMap).toEqual(MAP.slice(2));
    const towers = await db.selectFrom("tower").select("name").orderBy("name").execute();
    expect(towers.map(t => t.name)).toEqual(["Member", "Provider"]);
    const gbd = await db.selectFrom("queue_lob_map").select(["org_id", "org_name"]).where("queue_key", "=", "Q_GBD").executeTakeFirstOrThrow();
    expect(gbd).toEqual({ org_id: "gbd", org_name: "Anthem GBD" });
    await store.saveQueueMap(MAP, { role: "admin", who: null });
    expect((await store.loadBoot()).queueMap).toEqual(MAP);
    expect(Number((await db.selectFrom("lob").select(sql<string>`count(*)`.as("n")).executeTakeFirstOrThrow()).n)).toBe(3);
  });

  it("keeps a roster with its people, queues, membership and reporting lines", async () => {
    const store = postgresStore(db, { importDir: null });
    store.rosterChanged("commercial", ROSTER);
    await store.flush();
    const back = (await store.loadBoot()).rosters.commercial!;
    expect(back.queues).toEqual(ROSTER.queues);
    expect(back.agents).toEqual(ROSTER.agents);
    expect(back.members).toEqual(ROSTER.members);
    // A supervisor outside the roster's people is not kept.
    expect(new Map(back.people!.map(p => [p.uid, p.supervisor]))).toEqual(new Map([["a1", "tl1"], ["a2", null], ["tl1", "m1"], ["m1", null]]));
    const p = await db.selectFrom("person as p").leftJoin("lob as l", "l.lob_id", "p.lob_id").select(["p.person_id", "p.domain_id", "l.name as lob"]).where("p.person_id", "in", ["a1", "a2", "tl1", "m1"]).orderBy("p.person_id").execute();
    // a1 is on two Local queues and one Host queue: Local, whatever their home queue.
    expect(p).toEqual([
      { person_id: "a1", domain_id: "AB12345", lob: "Local" },
      { person_id: "a2", domain_id: "CD67890", lob: "Local" },
      { person_id: "m1", domain_id: "GH22222", lob: null },
      { person_id: "tl1", domain_id: "EF11111", lob: null },
    ]);
  });

  it("marks people who left the roster, and keeps known lines when a roster has none", async () => {
    const store = postgresStore(db, { importDir: null });
    const noLines = { ...ROSTER, people: undefined, queues: ROSTER.queues!.map(({ id, name }) => ({ id, name })) };
    store.rosterChanged("commercial", { ...noLines, agents: [{ uid: "a1", name: "Agent One - AB12345", team: "Q_HOST" }], members: { Q_LOCAL_1: ["a1"], Q_LOCAL_2: ["a1"], Q_HOST: ["a1"] } });
    await store.flush();
    const back = (await store.loadBoot()).rosters.commercial!;
    expect(back.agents.map(a => a.uid)).toEqual(["a1"]);
    // Kept from the roster before, which had them.
    expect(back.agents[0].lastLogin).toBe("2026-11-08T13:00:00.000Z");
    expect(back.queues?.[0].division).toBe("Claims");
    expect(back.people?.find(p => p.uid === "a1")?.supervisor).toBe("tl1");
    const a2 = await db.selectFrom("person").select(["active", "roster_pos"]).where("person_id", "=", "a2").executeTakeFirstOrThrow();
    expect(a2).toEqual({ active: false, roster_pos: null });
  });

  it("writes only the latest of several rosters waiting for one org", async () => {
    const store = postgresStore(db, { importDir: null });
    store.rosterChanged("gbd", { ...ROSTER, queues: [{ id: "g1", name: "Q_GBD" }], org: [{ team: "Q_GBD", tl: "", mgr: "", lob: "Q_GBD" }], agents: [{ uid: "g-a", name: "First", team: "Q_GBD" }], members: { Q_GBD: ["g-a"] }, people: undefined });
    store.rosterChanged("gbd", { ...ROSTER, queues: [{ id: "g1", name: "Q_GBD" }], org: [{ team: "Q_GBD", tl: "", mgr: "", lob: "Q_GBD" }], agents: [{ uid: "g-b", name: "Second", team: "Q_GBD" }], members: { Q_GBD: ["g-b"] }, people: undefined });
    await store.flush();
    expect((await store.loadBoot()).rosters.gbd!.agents.map(a => a.uid)).toEqual(["g-b"]);
    expect(await db.selectFrom("person").select("person_id").where("person_id", "=", "g-a").executeTakeFirst()).toBeUndefined();
  });

  it("keeps desktop-alert subscriptions and the org on screen", async () => {
    const store = postgresStore(db, { importDir: null });
    const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "k", auth: "a" } };
    store.subscriptionSaved({ sub, view: { role: "agent", who: "a1" } });
    store.subscriptionSaved({ sub, view: { role: "tl", who: "tl1" }, userAgent: "Chrome" }); // the browser moved to another person
    store.subscriptionDelivered(sub.endpoint);
    store.subscriptionSaved({ sub: { ...sub, endpoint: `${sub.endpoint}2` }, view: { role: "agent", who: "a2" } });
    store.subscriptionRemoved(`${sub.endpoint}2`);
    store.activeOrgChanged("specialty");
    store.activeOrgChanged("commercial");
    await store.flush();
    const boot = await store.loadBoot();
    expect(boot.subscriptions).toEqual([{ sub, view: { role: "tl", who: "tl1" }, userAgent: "Chrome" }]);
    const row = await db.selectFrom("push_subscription").select("last_success_at").executeTakeFirstOrThrow();
    expect(row.last_success_at).toBeInstanceOf(Date);
    expect(boot.activeOrg).toBe("commercial");
  });

  it("keeps rule overrides by Tower, Sub-Tower and LOB as versions, and loads the current ones", async () => {
    const store = postgresStore(db, { foldMs: 20, importDir: null });
    const LOCAL = { tower: "Provider", subTower: "Claims", lob: "Local" };
    const TOWER = { tower: "Provider", subTower: "", lob: "" };
    store.overrideChanged("acw", { ...LOCAL, thr: 200 });
    store.overrideChanged("acw", { ...LOCAL, thr: 240, sev: "crit" }); // folds into the one before
    store.overrideChanged("acw", { ...TOWER, on: false });
    // A place the mapping does not have yet is made, so the override has a row to point at.
    store.overrideChanged("cq", { tower: "Specialty", subTower: "Dental", lob: "", thr: 4 });
    await store.flush();
    const rules = await postgresStore(db).loadRules();
    expect(rules.find(r => r.id === "acw")!.overrides).toEqual([{ ...LOCAL, thr: 240, sev: "crit" }, { ...TOWER, on: false }]);
    expect(rules.find(r => r.id === "cq")!.overrides).toEqual([{ tower: "Specialty", subTower: "Dental", lob: "", thr: 4 }]);
    const lob = await db.selectFrom("rule_override").select(["scope_level", "version", "threshold"]).where("rule_id", "=", "acw").where("lob_id", "is not", null).execute();
    expect(lob).toEqual([{ scope_level: "lob", version: 1, threshold: "240" }]);

    // Removing one keeps its history as a version with nothing set.
    store.overrideChanged("acw", { ...LOCAL });
    store.overrideChanged("acw", { ...TOWER, on: false }); // unchanged: no new version
    await store.flush();
    expect((await postgresStore(db).loadRules()).find(r => r.id === "acw")!.overrides).toEqual([{ ...TOWER, on: false }]);
    const versions = await db.selectFrom("rule_override").select(["version", "threshold"]).where("rule_id", "=", "acw").where("lob_id", "is not", null).orderBy("version").execute();
    expect(versions).toEqual([{ version: 1, threshold: "240" }, { version: 2, threshold: null }]);
    const audit = await db.selectFrom("audit_event").select("action").where("target_type", "=", "rule_override").orderBy("audit_id").execute();
    expect(audit.map(a => a.action)).toEqual(["rule_override.change", "rule_override.change", "rule_override.change", "rule_override.remove"]);
  });

  it("refuses an override that names no place, or more than one", async () => {
    const rule = { rule_id: "acw", version: 1, threshold: 10 };
    await expect(db.insertInto("rule_override").values(rule).execute()).rejects.toThrow(/rule_override_one_place/);
    const t = await db.selectFrom("tower").select("tower_id").limit(1).executeTakeFirstOrThrow();
    const l = await db.selectFrom("lob").select("lob_id").limit(1).executeTakeFirstOrThrow();
    await expect(db.insertInto("rule_override").values({ ...rule, tower_id: t.tower_id, lob_id: l.lob_id }).execute()).rejects.toThrow(/rule_override_one_place/);
  });

  describe("a Genesys floor's records", () => {
    const today = floorDate(new Date());
    const LOCAL = { tower: "Provider", subTower: "Claims", lob: "Local" };
    const callout = (n: number, strikes: number, over: Partial<Instance> = {}): Instance => ({
      n, t: 0, agent: "Floor Agent", agentId: "u-floor-agent", isFloor: false, team: "Team Alpha", place: LOCAL, rule: "Extended ACW", ruleId: "acw",
      val: "2:01", stage: strikes >= 3 ? "ops" : strikes === 2 ? "lead" : "nudge", sev: strikes >= 3 ? "esc" : "warn", status: "open", ackT: null,
      strikes, inc: "", cmt: null, cond: "State ACW longer than 120s", rev: 0, ...over,
    });
    const incident: Incident = { inc: "INC-2026-0042", t: 0, agent: "Floor Agent", agentId: "u-floor-agent", team: "Team Alpha", rule: "Extended ACW", ruleId: "acw", instances: 3, status: "Open", disposition: "", closedT: null };
    const at = new Date();

    it("keeps call-outs with their strikes and incidents, and brings them back after a restart", async () => {
      const store = postgresStore(db, { importDir: null });
      store.shiftStarted("commercial", today);
      store.instanceFired("commercial", "2026-01-05", callout(101, 1), { thr: 120, overrideAt: null, incident: null, at }); // an earlier day, still open
      store.instanceFired("commercial", "2026-01-05", callout(102, 2), { thr: 120, overrideAt: null, incident: null, at }); // an earlier day, acknowledged below
      store.instanceFired("commercial", today, callout(201, 1), { thr: 120, overrideAt: null, incident: null, at });
      store.instanceFired("commercial", today, callout(202, 2), { thr: 120, overrideAt: { tower: "Provider", subTower: "", lob: "" }, incident: null, at });
      store.instanceFired("commercial", today, callout(203, 3, { inc: incident.inc }), { thr: 120, overrideAt: null, incident, at });
      const floor = callout(204, 0, { agent: "Queue", agentId: null, isFloor: true, team: "Floor", place: undefined, rule: "Calls in queue", ruleId: "cq", stage: "lead", sev: "warn", val: "9 calls waiting" });
      store.instanceFired("commercial", today, floor, { thr: 4, overrideAt: null, incident: null, at });
      store.instancesAcked([102], null, "console", at);
      store.instanceCommented(201, "System was slow", at);
      store.instancesAcked([201], { role: "agent", who: "u-floor-agent" }, "console", at);
      store.instancesAcked([202, 204], { role: "tl", who: "someone-without-a-row" }, "ack_all", at);
      store.incidentMoved({ ...incident, status: "Investigating" }, "start", { role: "mgr", who: null }, at);
      store.floorFiredChanged("commercial", today, ["cq"]);
      await store.flush();

      const shift = await db.selectFrom("shift").select(["shift_id", "status", "floor_fired"]).where("org_id", "=", "commercial").where("status", "=", "active").execute();
      expect(shift).toEqual([expect.objectContaining({ status: "active", floor_fired: ["cq"] })]);
      const rows = await db.selectFrom("monitoring_instance").select(["instance_id", "status", "ack_via", "acknowledged_by", "agent_comment", "rule_override_id", "occurrence_count"]).orderBy("instance_id").execute();
      expect(rows.map(r => [r.instance_id, r.status, r.ack_via, r.acknowledged_by])).toEqual([
        ["101", "open", null, null], ["102", "acked", "console", null], ["201", "acked", "console", "u-floor-agent"],
        ["202", "acked", "ack_all", null], ["203", "open", null, null], ["204", "acked", "ack_all", null],
      ]);
      // The Tower-wide override kept from the earlier test applied to 202.
      expect(rows.find(r => r.instance_id === "202")!.rule_override_id).not.toBeNull();
      expect(rows.find(r => r.instance_id === "201")!.agent_comment).toBe("System was slow");
      expect(await db.selectFrom("incident_log").select(["incident_number", "instance_id", "strike", "status"]).execute())
        .toEqual([{ incident_number: "INC-2026-0042", instance_id: "203", strike: 3, status: "Investigating" }]);
      expect(await db.selectFrom("incident_counter").selectAll().execute()).toEqual([{ year: 2026, last_value: 42 }]);
      const audit = await db.selectFrom("audit_event").select(["action", "target_id", "actor_id", "actor_role"]).where("target_type", "in", ["monitoring_instance", "incident_log"]).orderBy("audit_id").execute();
      // The actor is kept as given, even without a person row; the call-out's acknowledged_by stays null.
      expect(audit).toEqual([
        { action: "monitoring_instance.ack_all", target_id: null, actor_id: "someone-without-a-row", actor_role: "tl" },
        { action: "incident.start", target_id: "INC-2026-0042", actor_id: null, actor_role: "mgr" },
      ]);

      const boot = await postgresStore(db, { importDir: null }).loadBoot();
      expect(boot.lastInstance).toBe(204);
      expect(boot.incidentSeq).toEqual({ year: 2026, n: 42 });
      const saved = boot.floors.commercial!;
      // Today's call-outs and the earlier day's open one, newest first.
      expect(saved.ledger.map(r => r.n)).toEqual([204, 203, 202, 201, 101]);
      expect(saved.ledger.find(r => r.n === 203)).toMatchObject({ inc: "INC-2026-0042", strikes: 3, stage: "ops", sev: "esc", agent: "Floor Agent", place: LOCAL });
      expect(saved.ledger.find(r => r.n === 204)).toMatchObject({ isFloor: true, agent: "Queue", agentId: null, strikes: 0, team: "Floor" });
      expect(saved.ledger.find(r => r.n === 201)).toMatchObject({ status: "acked", cmt: "System was slow" });
      expect(saved.incidents).toEqual([expect.objectContaining({ inc: "INC-2026-0042", status: "Investigating", instances: 3, agentId: "u-floor-agent" })]);
      expect(saved.strikes).toEqual({ "u-floor-agent": { acw: 3 } });
      expect(saved.floorFired).toEqual(["cq"]);
      expect(boot.floors.gbd).toBeUndefined();
    });

    it("keeps one active shift per org: a new day closes the one before", async () => {
      const store = postgresStore(db, { importDir: null });
      store.shiftStarted("gbd", "2026-03-07");
      store.shiftStarted("gbd", "2026-03-08"); // the day daylight saving starts: 23 hours
      store.shiftStarted("gbd", "2026-03-06"); // a late write for an earlier day: kept, closed
      await store.flush();
      const shifts = await db.selectFrom("shift").select(["shift_date", "status", sql<string>`extract(epoch FROM ends_at - starts_at) / 3600`.as("hours")]).where("org_id", "=", "gbd").orderBy("shift_date").execute();
      expect(shifts.map(s => [s.status, Number(s.hours)])).toEqual([["closed", 24], ["closed", 24], ["active", 23]]);
    });

    it("keeps the day's Genesys updates, rebuilds today's calls from them, and empties them at midnight", async () => {
      const store = postgresStore(db, { importDir: null });
      const now = new Date();
      const yesterday = new Date(floorMidnight(now).getTime() - 3600_000);
      const end = (uid: string, at: Date, durationSec: number, transferred = false): SourceEvent =>
        ({ org: "commercial", at, entityType: "agent", entityId: uid, metric: "call.end", value: "acw", payload: { state: "acw", callEnded: { transferred, durationSec } } });
      store.eventsReceived([end("u-floor-agent", yesterday, 999)]);
      store.eventsReceived([
        end("u-floor-agent", now, 200, true), end("u-floor-agent", now, 300),
        { org: "commercial", at: now, entityType: "agent", entityId: "u-floor-agent", metric: "state", value: "avail", payload: { state: "avail" } },
        { org: "commercial", at: now, entityType: "system", entityId: "floor", metric: "queue", value: null, payload: { cq: 3 } },
      ]);
      // Another org's floor already started today: only yesterday's row goes.
      store.eventsCleared(floorMidnight(now));
      await store.flush();
      const count = async () => Number((await db.selectFrom("source_event_stream").select(sql<string>`count(*)`.as("n")).executeTakeFirstOrThrow()).n);
      expect(await count()).toBe(4);

      const boot = await postgresStore(db, { importDir: null }).loadBoot();
      expect(boot.floors.commercial!.calls).toEqual({ "u-floor-agent": { calls: 2, transfers: 1, shortCalls: 0, aht: 250 } });

      // The next midnight, with nothing newer yet: the table is emptied.
      store.eventsCleared(new Date(now.getTime() + 60_000));
      await store.flush();
      expect(await count()).toBe(0);
    });

    it("logs desktop alerts, leaving out a call-out, person or browser it has no row for", async () => {
      const store = postgresStore(db, { importDir: null });
      store.notificationSent({ n: 203, who: "u-floor-agent", role: "agent", level: "ops", endpoint: "https://fcm.googleapis.com/x", status: "sent", at });
      store.notificationSent({ n: 999, who: "nobody", role: "tl", level: "lead", endpoint: "https://fcm.googleapis.com/y", status: "gone", at });
      await store.flush();
      const rows = await db.selectFrom("notification_log").select(["instance_id", "recipient_id", "endpoint_hash", "delivery_status", "notification_level"]).orderBy("notification_log_id").execute();
      expect(rows).toEqual([
        { instance_id: "203", recipient_id: "u-floor-agent", endpoint_hash: null, delivery_status: "sent", notification_level: "ops" },
        { instance_id: null, recipient_id: null, endpoint_hash: null, delivery_status: "gone", notification_level: "lead" },
      ]);
      // This month has its own partition, not the default one.
      const where = await sql<{ part: string }>`SELECT tableoid::regclass::text AS part FROM notification_log LIMIT 1`.execute(db);
      expect(where.rows[0].part).toMatch(/^notification_log_\d{4}_\d{2}$/);
    });

    it("adds the alert-log partitions still missing, moving rows out of the default one", async () => {
      // A month the migration made no partition for: its row lands in the default partition.
      const far = new Date(Date.UTC(2031, 4, 15, 12));
      await db.insertInto("notification_log").values({ notification_ts: far, recipient_role: "tl", channel: "push", notification_level: "lead", delivery_status: "sent" }).execute();
      const partOf = async () => (await sql<{ part: string }>`SELECT tableoid::regclass::text AS part FROM notification_log WHERE notification_ts = ${far}`.execute(db)).rows.map(r => r.part);
      expect(await partOf()).toEqual(["notification_log_default"]);

      expect(await ensureNotificationPartitions(db, far, 1)).toEqual(["notification_log_2031_05", "notification_log_2031_06"]);
      expect(await partOf()).toEqual(["notification_log_2031_05"]);
      // A second run, and the months the migration already made, add nothing.
      expect(await ensureNotificationPartitions(db, far, 1)).toEqual([]);
      expect(await ensureNotificationPartitions(db)).toEqual([]);
    });

    it("runs a Genesys floor end to end: each strike and incident lands on the right agent, and carries on after a restart", async () => {
      const ORG: OrgId = "specialty";
      const A = "u-e2e-amara", B = "u-e2e-joshua", TL = "u-e2e-lead", MGR = "u-e2e-mgr";
      const roster: RosterNames = {
        org: [{ team: "E2E Claims", tl: "", mgr: "", lob: "" }],
        agents: [{ uid: A, name: "Reyes, Amara - AG1001", team: "E2E Claims" }, { uid: B, name: "Lim, Joshua - AG1002", team: "E2E Claims" }],
        members: { "E2E Claims": [A, B] },
        queues: [{ id: "q-e2e-claims", name: "E2E Claims" }],
        people: [{ uid: A, name: "Reyes, Amara - AG1001", supervisor: TL }, { uid: B, name: "Lim, Joshua - AG1002", supervisor: TL }, { uid: TL, name: "Lead, Team - TL1001", supervisor: MGR }, { uid: MGR, name: "Mgr, Lob - MG1001", supervisor: null }],
      };
      // As lib/server/runtime.ts wires a Genesys floor: its recorder, and its feed wrapped to keep the raw events.
      const recorder = (store: Store): Recorder => ({
        fired: (rec, x) => store.instanceFired(ORG, today, rec, { ...x, at: new Date() }),
        acked: (recs, by, via) => store.instancesAcked(recs.map(r => r.n), by, via, new Date()),
        commented: r => store.instanceCommented(r.n, r.cmt ?? "", new Date()),
        incidentMoved: (i, action, by) => store.incidentMoved(i, action, by, new Date()),
        floorFired: keys => store.floorFiredChanged(ORG, today, keys),
      });
      const floor = async (store: Store) => {
        const boot = await store.loadBoot();
        const ids = { n: boot.lastInstance };
        const e = createEngine({}, { rules: await store.loadRules(), record: recorder(store), ids, incidents: incidentCounter({ ...(boot.incidentSeq ?? { year: 0, n: 0 }) }) });
        e.reset({ t: 9 * 3600 });
        const saved = boot.floors[ORG];
        if (saved) e.restore(saved, today);
        store.shiftStarted(ORG, today);
        let h!: FeedHandlers;
        recordingEvents({ kind: "gencloud", subscribe: x => { h = x; return () => {}; } }, ORG, rows => store.eventsReceived(rows)).subscribe(e.ingest);
        h.onRoster({ org: roster.org, agents: roster.agents.map(a => ({ uid: a.uid!, name: a.name, team: a.team, state: "avail" })), members: roster.members, people: roster.people });
        const run = (sec: number) => { for (let i = 0; i < sec; i++) { h.onHeartbeat(); e.tick(); } };
        const acw = e.thr("acw");
        /** A call ends into after-call work that runs past the ACW limit, then the agent is back. */
        const longAcw = (uid: string) => { h.onAgentState({ uid, state: "acw", callEnded: { transferred: true, durationSec: 300 } }); run(acw + 2); h.onAgentState({ uid, state: "avail" }); run(1); };
        return { e, h, run, longAcw, boot, ids };
      };
      const agent = (e: ReturnType<typeof createEngine>, uid: string) => e.S.agents.find(a => a.uid === uid)!;
      const tl = { role: "tl" as const, who: TL }, mgr = { role: "mgr" as const, who: MGR }, admin = { role: "admin" as const, who: null };

      // --- The first run of the day ---
      const store = postgresStore(db, { importDir: null });
      store.rosterChanged(ORG, roster);
      await store.flush();
      const one = await floor(store);
      const firstN = one.ids.n + 1;
      one.longAcw(A); one.longAcw(A); one.longAcw(A); // strikes 1, 2 and 3: the third opens an incident
      one.h.onAgentState({ uid: B, state: "avail", callEnded: { durationSec: Math.max(1, one.e.thr("short") - 5) } }); one.run(1); // B: one short call
      one.h.onQueue({ cq: 99, sl: 90, asa: 10, ab: 1 }); one.run(2); // the floor: calls waiting
      const byStrike = (uid: string, s: number) => one.e.S.ledger.find(r => r.agentId === uid && r.strikes === s && r.ruleId === "acw")!;
      const [s1, s2, s3] = [1, 2, 3].map(s => byStrike(A, s));
      const inc = one.e.S.incidents[0];
      expect([s1.stage, s2.stage, s3.stage, s3.inc]).toEqual(["nudge", "lead", "ops", inc.inc]);
      one.e.ack(s1.n, tl, "push");
      one.e.comment(s2.n, "System was slow", true);
      expect(one.e.ackAll(admin)).toBe(3); // strike 3, B's short call, the queue
      one.e.invAction(inc.inc, "start", undefined, mgr);
      one.e.invAction(inc.inc, "note", "Spoke to the agent; system was slow.", mgr);
      one.e.invAction(inc.inc, "record", "Coached", mgr);
      one.e.invAction(inc.inc, "close", "Coached on ACW.", mgr);
      await store.flush();

      const shift = await db.selectFrom("shift").select("shift_id").where("org_id", "=", ORG).where("shift_date", "=", sql<Date>`${today}::date`).executeTakeFirstOrThrow();
      const rows = await db.selectFrom("monitoring_instance").select(["instance_id", "person_id", "rule_id", "occurrence_count", "notification_level", "severity", "status", "ack_via", "acknowledged_by", "agent_comment"])
        .where("shift_id", "=", shift.shift_id).orderBy("instance_id").execute();
      // Every call-out names the agent it is about, or no one for the floor's.
      expect(rows.map(r => [Number(r.instance_id) - firstN, r.person_id, r.rule_id, r.occurrence_count, r.notification_level, r.status, r.ack_via, r.acknowledged_by])).toEqual([
        [0, A, "acw", 1, "nudge", "acked", "push", TL],
        [1, A, "acw", 2, "lead", "acked", "console", A],
        [2, A, "acw", 3, "ops", "acked", "ack_all", null],
        [3, B, "short", 1, "nudge", "acked", "ack_all", null],
        [4, null, "cq", 0, "lead", "acked", "ack_all", null],
      ]);
      expect(rows[1].agent_comment).toBe("System was slow");
      expect(rows[2].severity).toBe("esc");
      expect(await db.selectFrom("agent_rule_state").select(["person_id", "rule_id", "strikes"]).where("shift_id", "=", shift.shift_id).orderBy("person_id").execute())
        .toEqual([{ person_id: A, rule_id: "acw", strikes: 3 }, { person_id: B, rule_id: "short", strikes: 1 }]);
      const incRow = await db.selectFrom("incident_log").select(["incident_number", "instance_id", "person_id", "strike", "status", "disposition", "closed_at", "owner_id", "owner_role", "comments", "resolution"]).where("shift_id", "=", shift.shift_id).execute();
      expect(incRow).toEqual([{
        incident_number: inc.inc, instance_id: String(s3.n), person_id: A, strike: 3, status: "Closed", disposition: "Coached", closed_at: expect.any(Date),
        owner_id: MGR, owner_role: "mgr", comments: "Spoke to the agent; system was slow.", resolution: "Coached on ACW.",
      }]);
      expect(await db.selectFrom("audit_event").select(["action", "actor_id", "actor_role"]).where("target_id", "=", inc.inc).orderBy("audit_id").execute()).toEqual([
        { action: "incident.start", actor_id: MGR, actor_role: "mgr" }, { action: "incident.note", actor_id: MGR, actor_role: "mgr" },
        { action: "incident.record", actor_id: MGR, actor_role: "mgr" }, { action: "incident.close", actor_id: MGR, actor_role: "mgr" },
      ]);
      const ends = await db.selectFrom("source_event_stream").select(["entity_id", sql<string>`count(*)`.as("n")]).where("org_id", "=", ORG).where("metric_name", "=", "call.end").groupBy("entity_id").orderBy("entity_id").execute();
      expect(ends.map(r => [r.entity_id, Number(r.n)])).toEqual([[B, 1], [A, 3]].sort());

      // --- The app restarts mid-day ---
      const store2 = postgresStore(db, { importDir: null });
      const two = await floor(store2);
      expect(two.ids.n).toBe(firstN + 4);
      expect(two.e.S.ledger.map(r => [r.n - firstN, r.agentId, r.agent])).toEqual([
        [4, null, "Queue"], [3, B, "Lim, Joshua - AG1002"], [2, A, "Reyes, Amara - AG1001"], [1, A, "Reyes, Amara - AG1001"], [0, A, "Reyes, Amara - AG1001"],
      ]);
      expect(two.e.S.incidents).toEqual([expect.objectContaining({
        inc: inc.inc, agentId: A, status: "Closed", owner: { who: MGR, role: "mgr", name: "Mgr, Lob - MG1001" },
        comments: "Spoke to the agent; system was slow.", resolution: "Coached on ACW.",
      })]);
      expect(agent(two.e, A)).toMatchObject({ strikes: { acw: 3 }, calls: 3, transfers: 3, aht: 300 });
      expect(agent(two.e, B)).toMatchObject({ strikes: { short: 1 }, calls: 1, shortCalls: 1 });
      // The queue was still in breach: no second call-out for it.
      two.h.onQueue({ cq: 99, sl: 90, asa: 10, ab: 1 }); two.run(2);
      expect(two.e.S.ledger).toHaveLength(5);
      // A's next long ACW is strike 4, and opens the next incident on the shared counter.
      two.longAcw(A);
      const s4 = two.e.S.ledger[0];
      expect([s4.n, s4.agentId, s4.strikes, s4.stage]).toEqual([firstN + 5, A, 4, "ops"]);
      const [, year, n] = /^INC-(\d{4})-(\d+)$/.exec(inc.inc)!;
      expect(s4.inc).toBe(`INC-${year}-${String(Number(n) + 1).padStart(4, "0")}`);
      expect(agent(two.e, A).calls).toBe(4);
      await store2.flush();
      expect(await db.selectFrom("agent_rule_state").select("strikes").where("shift_id", "=", shift.shift_id).where("person_id", "=", A).executeTakeFirstOrThrow()).toEqual({ strikes: 4 });
      expect(await db.selectFrom("incident_log").select(["incident_number", "instance_id", "strike", "status"]).where("person_id", "=", A).orderBy("incident_id").execute()).toEqual([
        expect.objectContaining({ incident_number: inc.inc, strike: 3, status: "Closed" }),
        { incident_number: s4.inc, instance_id: String(s4.n), strike: 4, status: "Open" },
      ]);
    });

    it("refuses a strike on a floor call-out, and a closed incident without a final disposition", async () => {
      const shift = await db.selectFrom("shift").select("shift_id").limit(1).executeTakeFirstOrThrow();
      const base = { shift_id: shift.shift_id, rule_id: "cq", rule_version: 1, metric_value: "9", threshold_value: 4, condition_text: "x", severity: "warn", notification_level: "lead" };
      await expect(db.insertInto("monitoring_instance").values({ ...base, instance_id: 900, occurrence_count: 1 }).execute()).rejects.toThrow(/monitoring_instance_strike/);
      await expect(db.updateTable("incident_log").set({ status: "Closed", closed_at: new Date(), disposition: "Pending Investigation" }).execute()).rejects.toThrow(/incident_log_closed/);
    });
  });

  it("refuses a rule version that breaks a check, and leaves the rule as it was", async () => {
    const store = postgresStore(db, { foldMs: 20, log: () => {} });
    const hold = (await store.loadRules()).find(r => r.id === "hold")!;
    hold.thr = 0; store.ruleChanged(hold);
    await store.flush();
    expect((await postgresStore(db).loadRules()).find(r => r.id === "hold")!.thr).toBe(120);
    await store.close().catch(() => {});
  });

  it("undoes every migration cleanly (local only)", async () => {
    db = createDb({ DB_SSLMODE: sslMode, DB_POOL_MAX: 2 }, url);
    const down = await migrator().migrateTo(NO_MIGRATIONS);
    expect(down.error).toBeUndefined();
    const tables = await db.introspection.getTables();
    expect(tables.map(t => t.name)).toEqual([]);
  });
});
