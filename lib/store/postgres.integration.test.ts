import { promises as fs } from "node:fs";
import path from "node:path";
import { type Kysely, sql } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@/lib/db/client";
import type { DB } from "@/lib/db/schema";
import { databaseUrl, isTestDatabase, testDatabaseUrl } from "@/lib/db/url";
import { defaultRules } from "@/lib/engine/rules";
import { postgresStore } from "./postgres";

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
  const migrator = () => new Migrator({ db, provider: new FileMigrationProvider({ fs, path, migrationFolder: path.join(__dirname, "../db/migrations") }) });

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
    expect(first.results?.map(r => r.status)).toEqual(["Success"]);
    const second = await migrator().migrateToLatest();
    expect(second.error).toBeUndefined();
    expect(second.results).toEqual([]);
  });

  it("writes the reference data", async () => {
    const count = async (t: keyof DB) => Number((await db.selectFrom(t).select(sql<string>`count(*)`.as("n")).executeTakeFirstOrThrow()).n);
    expect(await count("genesys_region")).toBe(2);
    expect(await count("genesys_org")).toBe(3);
    expect(await count("notification_route")).toBe(4);
    expect(await count("notification_route_step")).toBe(7);
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

  it("refuses a rule version that breaks a check, and leaves the rule as it was", async () => {
    const store = postgresStore(db, { foldMs: 20, log: () => {} });
    const hold = (await store.loadRules()).find(r => r.id === "hold")!;
    hold.thr = 0; store.ruleChanged(hold);
    await store.flush();
    expect((await postgresStore(db).loadRules()).find(r => r.id === "hold")!.thr).toBe(120);
    await store.close().catch(() => {});
  });

  it("undoes the migration cleanly (local only)", async () => {
    db = createDb({ DB_SSLMODE: sslMode, DB_POOL_MAX: 2 }, url);
    const down = await migrator().migrateDown();
    expect(down.error).toBeUndefined();
    const tables = await db.introspection.getTables();
    expect(tables.map(t => t.name)).toEqual([]);
  });
});
