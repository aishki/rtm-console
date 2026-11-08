import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { type Kysely, sql } from "kysely";
import { type Migration, type MigrationProvider, Migrator, NO_MIGRATIONS } from "kysely/migration";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@/lib/db/client";
import type { DB } from "@/lib/db/schema";
import { databaseUrl, isTestDatabase, testDatabaseUrl } from "@/lib/db/url";
import { defaultRules } from "@/lib/engine/rules";
import type { QueueMapRow } from "@/lib/import/queueMap";
import { postgresStore } from "./postgres";
import type { RosterNames } from "./store";

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
    expect(first.results?.map(r => r.status)).toEqual(["Success", "Success", "Success", "Success"]);
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
    sl.thr = 85; store.ruleChanged(sl, "a");
    sl.thr = 90; store.ruleChanged(sl, "b");
    await store.flush();
    const auxp = (await store.loadRules()).find(r => r.id === "auxp")!;
    auxp.on = false; store.ruleChanged(auxp);
    auxp.on = true; store.ruleChanged(auxp);
    await store.flush();
    const rows = await db.selectFrom("rule_version").select(["rule_id", "version", "threshold", "changed_by"]).where("rule_id", "in", ["sl", "auxp"]).orderBy("rule_id").orderBy("version").execute();
    expect(rows.map(r => [r.rule_id, r.version, Number(r.threshold), r.changed_by])).toEqual([
      ["auxp", 1, 300, null], ["sl", 1, 80, null], ["sl", 2, 85, "a"], ["sl", 3, 90, "b"],
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
    await store.saveQueueMap(MAP.slice(2), "admin-1");
    expect((await store.loadBoot()).queueMap).toEqual(MAP.slice(2));
    const towers = await db.selectFrom("tower").select("name").orderBy("name").execute();
    expect(towers.map(t => t.name)).toEqual(["Member", "Provider"]);
    const gbd = await db.selectFrom("queue_lob_map").select(["org_id", "org_name"]).where("queue_key", "=", "Q_GBD").executeTakeFirstOrThrow();
    expect(gbd).toEqual({ org_id: "gbd", org_name: "Anthem GBD" });
    await store.saveQueueMap(MAP, "admin-1");
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
