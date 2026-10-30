import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { DB } from "./schema";
import { databaseUrl, pgSsl } from "./url";

// One connection pool per process, made when the first query needs it.

export interface PoolSettings {
  DATABASE_URL?: string; DB_HOST?: string; DB_PORT?: number; DB_NAME?: string; DB_USER?: string; DB_PASSWORD?: string; DB_SCHEMA?: string;
  DB_SSLMODE: "verify-full" | "no-verify" | "disable"; DB_CA_CERT?: string; DB_POOL_MAX: number;
}

/** A pg pool for these settings. Nothing connects until the first query. */
export function createPool(s: PoolSettings, url = databaseUrl(s)): Pool {
  return new Pool({ connectionString: url, ssl: pgSsl(s.DB_SSLMODE, s.DB_CA_CERT), max: s.DB_POOL_MAX, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 });
}

/** A Kysely instance over a lazily created pool. */
export function createDb(s: PoolSettings, url?: string): Kysely<DB> {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool: async () => createPool(s, url) }) });
}
