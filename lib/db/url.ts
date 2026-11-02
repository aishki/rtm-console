import { readFileSync } from "node:fs";
import { rootCertificates } from "node:tls";

// How the console finds its database. Pure functions, apart from reading a certificate file, and no
// Next.js: the app, the migration tools and the tests all use them.
//
// An explicit DATABASE_URL always wins. Otherwise the URL is composed from DB_HOST, DB_PORT,
// DB_NAME, DB_USER and DB_PASSWORD. A DATABASE_URL exported in the shell beats the one in
// .env.local, because the loader never overwrites a variable that is already set.

export interface DbSettings {
  DATABASE_URL?: string;
  DB_HOST?: string;
  DB_PORT?: number;
  DB_NAME?: string;
  DB_USER?: string;
  DB_PASSWORD?: string;
  DB_SCHEMA?: string;
}

/** The connection URL. DB_SCHEMA, when set, is added as the session's search_path. */
export function databaseUrl(s: DbSettings): string {
  let url = s.DATABASE_URL;
  if (!url) {
    if (!s.DB_HOST || !s.DB_NAME || !s.DB_USER || s.DB_PASSWORD === undefined) throw new Error("No database settings: set DATABASE_URL, or DB_HOST, DB_NAME, DB_USER and DB_PASSWORD.");
    const auth = `${encodeURIComponent(s.DB_USER)}:${encodeURIComponent(s.DB_PASSWORD)}`;
    url = `postgres://${auth}@${s.DB_HOST}:${s.DB_PORT ?? 5432}/${encodeURIComponent(s.DB_NAME)}`;
  }
  return s.DB_SCHEMA ? withSchema(url, s.DB_SCHEMA) : url;
}

/** `url` with its search_path set to `schema`, replacing any it had. */
export function withSchema(url: string, schema: string): string {
  const u = new URL(url);
  const others = (u.searchParams.get("options") ?? "").split(/\s+(?=-c)/).filter(o => o && !/search_path\s*=/.test(o));
  u.searchParams.set("options", [...others, `-c search_path=${schema}`].join(" "));
  return u.toString();
}

/** The schema a URL works in (the first in its search_path), or null when it sets none. */
export function schemaFromUrl(url: string): string | null {
  const options = new URL(url).searchParams.get("options") ?? "";
  const m = /search_path\s*=\s*([^\s,]+)/.exec(options);
  return m ? m[1].replace(/^"|"$/g, "") : null;
}

/** The database name in a URL. */
export const databaseFromUrl = (url: string): string => decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));

/**
 * The database for integration tests: TEST_DATABASE_URL if set; otherwise the main URL with its
 * schema renamed `<schema>_test` when it uses one; otherwise the database `<database>_test`.
 */
export function testDatabaseUrl(mainUrl: string, explicit?: string): string {
  if (explicit) return explicit;
  const schema = schemaFromUrl(mainUrl);
  if (schema) return withSchema(mainUrl, `${schema}_test`);
  const u = new URL(mainUrl);
  u.pathname = `/${encodeURIComponent(`${databaseFromUrl(mainUrl)}_test`)}`;
  return u.toString();
}

/** True only for a test database or schema: integration tests refuse anything else. */
export function isTestDatabase(url: string): boolean {
  const schema = schemaFromUrl(url);
  return schema ? schema.endsWith("_test") : databaseFromUrl(url).endsWith("_test");
}

export type SslMode = "verify-full" | "no-verify" | "disable";

/**
 * The `ssl` option for pg. verify-full trusts Node's usual authorities plus DB_CA_CERT (the RDS
 * bundle on EC2, or a company's certificate behind TLS inspection): added, never a replacement.
 */
export function pgSsl(mode: SslMode, caFile?: string, read: (f: string) => string = f => readFileSync(f, "utf8")): false | { rejectUnauthorized: boolean; ca?: string[] } {
  if (mode === "disable") return false;
  if (mode === "no-verify") return { rejectUnauthorized: false };
  return caFile ? { rejectUnauthorized: true, ca: [...rootCertificates, read(caFile)] } : { rejectUnauthorized: true };
}
