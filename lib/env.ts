import { existsSync } from "node:fs";
import { z } from "zod";

// The server's settings, checked in one place. `parseEnv()` checks a set of variables and returns a
// typed object; `env()` does it once for this process. Nothing else on the server reads process.env.
// instrumentation.ts calls env() before the server takes a request, so a broken deployment stops at
// start-up with one message naming every problem.
//
// Two exceptions read process.env themselves, because they also run in the browser bundle:
// NEXT_PUBLIC_* in client code (Next.js inlines them at build time) and RTM_TIME_ZONE in
// lib/floorTime.ts. Both are still checked here.
//
// Rules: `KEY=` is an empty string and fails; a commented-out `# KEY=` is absent, which optional
// settings allow. Secrets never get a default. Pairs are checked together, in the schema.

export const APP_ENVS = ["development", "test", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];
/** Where the in-memory store and relaxed TLS are allowed. An allowlist: a new environment name gets neither. */
const SAFE_ENVS: readonly AppEnv[] = ["development", "test"];

/** Values copied from an example and never replaced. */
const PLACEHOLDER = /^(\.\.\.|…|changeme|change[-_ ]?me|password|secret|replace[-_ ]?me|todo|x{3,}|<.*>|your[-_ ].*)$/i;

const text = () => z.string().min(1, { error: "is empty: set a value, or comment the line out to leave it unset", abort: true });
const secret = (min: number) => text()
  .min(min, `must be at least ${min} characters`)
  .refine(v => !PLACEHOLDER.test(v.trim()), "is still a placeholder value");
const flag = () => z.enum(["0", "1"], { error: 'must be "1" or "0"' });
const int = (min: number, max: number) => z.coerce.number({ error: "must be a whole number" }).int("must be a whole number").min(min).max(max);
const pgUrl = () => text().regex(/^postgres(ql)?:\/\//, "must start with postgres:// or postgresql://");

function validZone(zone: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; } catch { return false; }
}

const fields = {
  /** Which environment this really is. Not NODE_ENV, which every `next build` sets to production. */
  APP_ENV: z.enum(APP_ENVS, { error: `must be one of: ${APP_ENVS.join(", ")}` }),
  /** Where records are kept. `memory` keeps nothing past a restart, and only development and test may use it. */
  PERSISTENCE_MODE: z.enum(["postgres", "memory"], { error: "must be postgres or memory" }),

  DATABASE_URL: pgUrl().optional(),
  DB_HOST: text().optional(),
  DB_PORT: int(1, 65535).default(5432),
  DB_NAME: text().optional(),
  DB_USER: text().optional(),
  DB_PASSWORD: text().optional(),
  DB_SCHEMA: text().regex(/^[a-z_][a-z0-9_]*$/, "must be a lower-case PostgreSQL name (letters, digits, _)").optional(),
  DB_SSLMODE: z.enum(["verify-full", "no-verify", "disable"], { error: "must be verify-full, no-verify or disable" }).default("verify-full"),
  DB_CA_CERT: text().optional(),
  DB_POOL_MAX: int(1, 50).default(10),
  TEST_DATABASE_URL: pgUrl().optional(),

  NEXT_PUBLIC_FEED: text().optional(),
  NEXT_PUBLIC_VIEW_AS: flag().optional(),
  NEXT_PUBLIC_DEV_TOOLS: flag().optional(),

  RTM_SITE_PASSWORD: secret(8).optional(),
  RTM_ADMIN_SECRET: secret(16).optional(),
  RTM_TIME_ZONE: text().refine(validZone, "is not a time zone (use an IANA name such as America/New_York)").default("America/New_York"),

  GENESYS_TOKEN: text().optional(),
  GBD_TOKEN: text().optional(),
  SPECIALTY_TOKEN: text().optional(),
  GENCLOUD_API_BASE: text().regex(/^https:\/\//, "must start with https://").optional(),
  RTM_VIEW_CONFIG_ID: text().optional(),
  GENCLOUD_CLIENT_ID: text().optional(),
  GENCLOUD_CLIENT_SECRET: secret(8).optional(),

  VAPID_PUBLIC_KEY: text().optional(),
  VAPID_PRIVATE_KEY: secret(8).optional(),
  VAPID_SUBJECT: text().regex(/^(mailto:|https:\/\/)/, "must start with mailto: or https://").optional(),

  AWS_ACCESS_KEY_ID: text().optional(),
  AWS_SECRET_ACCESS_KEY: secret(16).optional(),
  AWS_SESSION_TOKEN: text().optional(),
};

type Issue = { path: string; message: string };
type Raw = Record<string, string | undefined>;

/** The database settings: a full URL, or all of DB_HOST, DB_NAME, DB_USER and DB_PASSWORD. */
function checkDatabase(v: Raw, required: boolean, add: (i: Issue) => void): void {
  const parts = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"] as const;
  const set = parts.filter(k => v[k] !== undefined);
  if (v.DATABASE_URL === undefined && set.length > 0 && set.length < parts.length) {
    for (const k of parts) if (v[k] === undefined) add({ path: k, message: `is missing: the DB_* settings go together (${parts.join(", ")}), or set DATABASE_URL instead` });
  } else if (required && v.DATABASE_URL === undefined && set.length === 0) {
    add({ path: "DATABASE_URL", message: "is missing: set DATABASE_URL, or DB_HOST, DB_NAME, DB_USER and DB_PASSWORD" });
  }
  for (const k of ["DATABASE_URL", "TEST_DATABASE_URL"] as const) {
    if (v[k] && /[?&](sslmode|sslrootcert|sslcert|sslkey|ssl)=/i.test(v[k]!)) add({ path: k, message: "has an ssl setting in it: use DB_SSLMODE and DB_CA_CERT instead" });
  }
}

function checkTls(v: { APP_ENV: AppEnv; DB_SSLMODE: string; DB_CA_CERT?: string }, add: (i: Issue) => void): void {
  if (v.DB_SSLMODE === "no-verify" && v.APP_ENV !== "development") add({ path: "DB_SSLMODE", message: "no-verify is allowed only when APP_ENV is development. Add the certificate with DB_CA_CERT instead" });
  if (v.DB_SSLMODE === "disable" && !SAFE_ENVS.includes(v.APP_ENV)) add({ path: "DB_SSLMODE", message: "disable is allowed only when APP_ENV is development or test" });
  if (v.DB_CA_CERT && !existsSync(v.DB_CA_CERT)) add({ path: "DB_CA_CERT", message: "names a file that does not exist" });
}

const all = (keys: readonly string[], v: Raw) => keys.every(k => v[k] !== undefined);
const none = (keys: readonly string[], v: Raw) => keys.every(k => v[k] === undefined);

const serverSchema = z.object(fields).superRefine((v, ctx) => {
  const add = (i: Issue) => ctx.addIssue({ code: "custom", path: [i.path], message: i.message });
  const raw = v as unknown as Raw;

  if (v.PERSISTENCE_MODE === "memory" && !SAFE_ENVS.includes(v.APP_ENV)) {
    add({ path: "PERSISTENCE_MODE", message: `memory keeps nothing past a restart and is allowed only when APP_ENV is ${SAFE_ENVS.join(" or ")}` });
  }
  checkDatabase(raw, v.PERSISTENCE_MODE === "postgres", add);
  checkTls(v, add);

  const oauth = ["GENCLOUD_CLIENT_ID", "GENCLOUD_CLIENT_SECRET"];
  if (!all(oauth, raw) && !none(oauth, raw)) for (const k of oauth) if (raw[k] === undefined) add({ path: k, message: "is missing: the Genesys OAuth client needs both its ID and its secret" });

  const vapid = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"];
  if (!all(vapid, raw) && !none(vapid, raw)) for (const k of vapid) if (raw[k] === undefined) add({ path: k, message: "is missing: desktop alerts need all three VAPID settings, or none" });

  // Explicit AWS keys are for local work only. On EC2 the instance profile is used and none are set.
  const hasKey = v.AWS_ACCESS_KEY_ID !== undefined, hasSecret = v.AWS_SECRET_ACCESS_KEY !== undefined;
  if (hasKey !== hasSecret) add({ path: hasKey ? "AWS_SECRET_ACCESS_KEY" : "AWS_ACCESS_KEY_ID", message: "is missing: AWS keys need both the access key ID and the secret, or neither (to use the instance profile)" });
  if (v.AWS_SESSION_TOKEN !== undefined && !hasKey) add({ path: "AWS_SESSION_TOKEN", message: "is set without AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY" });
  if (v.AWS_ACCESS_KEY_ID?.startsWith("ASIA") && v.AWS_SESSION_TOKEN === undefined) add({ path: "AWS_SESSION_TOKEN", message: "is missing: a temporary key (ASIA…) only works with its session token" });
});

export type Env = z.infer<typeof serverSchema>;

/** A failed check, with every problem found. Never includes a value. */
export class EnvError extends Error {
  constructor(readonly issues: Issue[], what = "settings") {
    super(`The server's ${what} are not valid:\n${issues.map(i => `  - ${i.path} ${i.message}`).join("\n")}\nSee .env.example for what each one does.`);
    this.name = "EnvError";
  }
}

/** Drop the variables that are unset, so a schema sees only what was given. */
const given = (raw: Raw): Raw => Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));

function parseWith<T>(schema: z.ZodType<T>, raw: Raw, what?: string): T {
  const r = schema.safeParse(given(raw));
  if (r.success) return r.data;
  throw new EnvError(r.error.issues.map(i => ({ path: i.path.join(".") || "(settings)", message: i.message })), what);
}

/** Check a set of variables (process.env, or a test's). Throws an EnvError listing every problem. */
export const parseEnv = (raw: Raw): Env => parseWith(serverSchema, raw);

const dbFields = { APP_ENV: fields.APP_ENV, DATABASE_URL: fields.DATABASE_URL, DB_HOST: fields.DB_HOST, DB_PORT: fields.DB_PORT, DB_NAME: fields.DB_NAME, DB_USER: fields.DB_USER, DB_PASSWORD: fields.DB_PASSWORD, DB_SCHEMA: fields.DB_SCHEMA, DB_SSLMODE: fields.DB_SSLMODE, DB_CA_CERT: fields.DB_CA_CERT, DB_POOL_MAX: fields.DB_POOL_MAX, TEST_DATABASE_URL: fields.TEST_DATABASE_URL };
const dbSchema = z.object(dbFields).superRefine((v, ctx) => {
  const add = (i: Issue) => ctx.addIssue({ code: "custom", path: [i.path], message: i.message });
  checkDatabase(v as unknown as Raw, true, add);
  checkTls(v, add);
});
export type DbEnv = z.infer<typeof dbSchema>;

/** Only what the database tools (db:migrate and the rest) need. They run with the migrator's login and none of the app's secrets. */
export const parseDbEnv = (raw: Raw): DbEnv => parseWith(dbSchema, raw, "database settings");

const publicSchema = z.object({ NEXT_PUBLIC_FEED: fields.NEXT_PUBLIC_FEED, NEXT_PUBLIC_VIEW_AS: fields.NEXT_PUBLIC_VIEW_AS, NEXT_PUBLIC_DEV_TOOLS: fields.NEXT_PUBLIC_DEV_TOOLS });
/** The settings built into the browser bundle, checked by next.config.ts at build time. */
export const parsePublicEnv = (raw: Raw) => parseWith(publicSchema, raw, "build settings");

let cached: Env | undefined;
/** This process's settings, checked on first use. */
export function env(): Env {
  return (cached ??= parseEnv(process.env));
}

export type AwsCredentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
/**
 * The credentials to give an AWS SDK client: undefined means leave `credentials` out, so the SDK's
 * default chain (the EC2 instance profile) is used. parseEnv has already refused half a set.
 */
export function awsCredentials(e: Pick<Env, "AWS_ACCESS_KEY_ID" | "AWS_SECRET_ACCESS_KEY" | "AWS_SESSION_TOKEN">): AwsCredentials | undefined {
  if (!e.AWS_ACCESS_KEY_ID || !e.AWS_SECRET_ACCESS_KEY) return undefined;
  return { accessKeyId: e.AWS_ACCESS_KEY_ID, secretAccessKey: e.AWS_SECRET_ACCESS_KEY, ...(e.AWS_SESSION_TOKEN ? { sessionToken: e.AWS_SESSION_TOKEN } : {}) };
}
