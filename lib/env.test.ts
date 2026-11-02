import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EnvError, awsCredentials, parseDbEnv, parseEnv, parsePublicEnv } from "./env";

const BASE = { APP_ENV: "development", PERSISTENCE_MODE: "memory" };
const DB = { DB_HOST: "localhost", DB_NAME: "rtm_console", DB_USER: "rtm_app", DB_PASSWORD: "p@ss:word/1" };

/** The problems a failed check reports, as "VARIABLE message". */
function problems(raw: Record<string, string | undefined>, parse: (r: Record<string, string | undefined>) => unknown = parseEnv): string[] {
  try { parse(raw); } catch (e) {
    if (e instanceof EnvError) return e.issues.map(i => `${i.path} ${i.message}`);
    throw e;
  }
  return [];
}
const paths = (raw: Record<string, string | undefined>, parse?: (r: Record<string, string | undefined>) => unknown) => problems(raw, parse).map(p => p.split(" ")[0]);

/** .env.example as a loader would read it: comments and blank lines skipped, quotes removed. */
function readExample(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path.join(__dirname, "..", ".env.example"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}

describe("parseEnv", () => {
  it("accepts a development setup with no database, and fills the safe defaults", () => {
    const e = parseEnv(BASE);
    expect(e.APP_ENV).toBe("development");
    expect(e.DB_PORT).toBe(5432);
    expect(e.DB_POOL_MAX).toBe(10);
    expect(e.DB_SSLMODE).toBe("verify-full");
    expect(e.RTM_TIME_ZONE).toBe("America/New_York");
  });

  it("reports every problem in one pass, never only the first", () => {
    const found = paths({ PERSISTENCE_MODE: "files", DB_PORT: "abc", RTM_TIME_ZONE: "Mars/Olympus" });
    expect(found).toEqual(expect.arrayContaining(["APP_ENV", "PERSISTENCE_MODE", "DB_PORT", "RTM_TIME_ZONE"]));
  });

  it("refuses .env.example copied as it is, with a readable message", () => {
    const example = readExample();
    expect(() => parseEnv(example)).toThrow(EnvError);
    expect(paths(example)).toContain("APP_ENV");
    try { parseEnv(example); } catch (e) { expect((e as Error).message).toMatch(/^The server's settings are not valid:\n {2}- APP_ENV /); }
  });

  it("treats a commented-out setting as absent, and an empty one as an error", () => {
    expect(paths({ ...BASE })).toEqual([]);
    expect(paths({ ...BASE, RTM_ADMIN_SECRET: undefined })).toEqual([]);
    expect(problems({ ...BASE, RTM_ADMIN_SECRET: "" })).toEqual(["RTM_ADMIN_SECRET is empty: set a value, or comment the line out to leave it unset"]);
    expect(paths({ ...BASE, GENESYS_TOKEN: "" })).toEqual(["GENESYS_TOKEN"]);
  });

  it("never puts a value in its message", () => {
    const message = (() => { try { parseEnv({ ...BASE, RTM_ADMIN_SECRET: "short-secret", GENCLOUD_CLIENT_SECRET: "hunter2-but-long" }); } catch (e) { return (e as Error).message; } return ""; })();
    expect(message).toContain("RTM_ADMIN_SECRET");
    expect(message).not.toContain("short-secret");
    expect(message).not.toContain("hunter2");
  });

  it("refuses short secrets and placeholders, and accepts a real one", () => {
    expect(paths({ ...BASE, RTM_SITE_PASSWORD: "abc" })).toEqual(["RTM_SITE_PASSWORD"]);
    expect(paths({ ...BASE, RTM_SITE_PASSWORD: "changeme" })).toEqual(["RTM_SITE_PASSWORD"]);
    expect(paths({ ...BASE, RTM_ADMIN_SECRET: "<a long random secret>" })).toEqual(["RTM_ADMIN_SECRET"]);
    expect(paths({ ...BASE, RTM_ADMIN_SECRET: "k3Jd92-x8Vq0w1Lm" })).toEqual([]);
  });

  it("allows the memory store only in development and test", () => {
    expect(paths({ APP_ENV: "test", PERSISTENCE_MODE: "memory" })).toEqual([]);
    expect(paths({ APP_ENV: "staging", PERSISTENCE_MODE: "memory" })).toContain("PERSISTENCE_MODE");
    expect(paths({ APP_ENV: "production", PERSISTENCE_MODE: "memory" })).toContain("PERSISTENCE_MODE");
    // An environment name nobody listed gets nothing, rather than everything.
    expect(paths({ APP_ENV: "qa", PERSISTENCE_MODE: "memory" })).toContain("APP_ENV");
  });

  it("needs database settings for the postgres store: a URL, or all four DB_* values", () => {
    expect(paths({ APP_ENV: "production", PERSISTENCE_MODE: "postgres" })).toEqual(["DATABASE_URL"]);
    expect(paths({ APP_ENV: "production", PERSISTENCE_MODE: "postgres", DATABASE_URL: "postgres://a:b@h/db" })).toEqual([]);
    expect(paths({ APP_ENV: "production", PERSISTENCE_MODE: "postgres", ...DB })).toEqual([]);
    expect(paths({ APP_ENV: "production", PERSISTENCE_MODE: "postgres", DB_HOST: "h", DB_NAME: "db" })).toEqual(["DB_USER", "DB_PASSWORD"]);
    expect(paths({ ...BASE, DATABASE_URL: "mysql://h/db" })).toEqual(["DATABASE_URL"]);
  });

  it("keeps TLS settings out of the URL, and relaxed TLS out of deployed environments", () => {
    expect(paths({ ...BASE, DATABASE_URL: "postgres://a:b@h/db?sslmode=require" })).toEqual(["DATABASE_URL"]);
    expect(paths({ ...BASE, DB_SSLMODE: "no-verify" })).toEqual([]);
    expect(paths({ APP_ENV: "test", PERSISTENCE_MODE: "memory", DB_SSLMODE: "no-verify" })).toEqual(["DB_SSLMODE"]);
    expect(paths({ APP_ENV: "test", PERSISTENCE_MODE: "memory", DB_SSLMODE: "disable" })).toEqual([]);
    expect(paths({ APP_ENV: "production", PERSISTENCE_MODE: "postgres", ...DB, DB_SSLMODE: "disable" })).toEqual(["DB_SSLMODE"]);
    expect(paths({ ...BASE, DB_CA_CERT: path.join(__dirname, "no-such-file.pem") })).toEqual(["DB_CA_CERT"]);
  });

  it("checks pairs together: the Genesys OAuth client, and all three VAPID values", () => {
    expect(paths({ ...BASE, GENCLOUD_CLIENT_ID: "id" })).toEqual(["GENCLOUD_CLIENT_SECRET"]);
    expect(paths({ ...BASE, GENCLOUD_CLIENT_ID: "id", GENCLOUD_CLIENT_SECRET: "a-real-secret" })).toEqual([]);
    expect(paths({ ...BASE, VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "private-key-value" })).toEqual(["VAPID_SUBJECT"]);
    expect(paths({ ...BASE, VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "private-key-value", VAPID_SUBJECT: "mailto:ops@example.com" })).toEqual([]);
    expect(paths({ ...BASE, VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "private-key-value", VAPID_SUBJECT: "ops@example.com" })).toEqual(["VAPID_SUBJECT"]);
  });

  it("refuses half a set of AWS keys, and a temporary key without its session token", () => {
    const secret = "abcdefghijklmnopqrstuvwxyz0123456789ABCD";
    expect(paths({ ...BASE, AWS_ACCESS_KEY_ID: "AKIAEXAMPLE" })).toEqual(["AWS_SECRET_ACCESS_KEY"]);
    expect(paths({ ...BASE, AWS_SECRET_ACCESS_KEY: secret })).toEqual(["AWS_ACCESS_KEY_ID"]);
    expect(paths({ ...BASE, AWS_SESSION_TOKEN: "token" })).toEqual(["AWS_SESSION_TOKEN"]);
    expect(paths({ ...BASE, AWS_ACCESS_KEY_ID: "ASIAEXAMPLE", AWS_SECRET_ACCESS_KEY: secret })).toEqual(["AWS_SESSION_TOKEN"]);
    expect(paths({ ...BASE, AWS_ACCESS_KEY_ID: "ASIAEXAMPLE", AWS_SECRET_ACCESS_KEY: secret, AWS_SESSION_TOKEN: "token" })).toEqual([]);
    expect(paths({ ...BASE, AWS_ACCESS_KEY_ID: "AKIAEXAMPLE", AWS_SECRET_ACCESS_KEY: secret })).toEqual([]);
  });
});

describe("awsCredentials", () => {
  it("leaves credentials out (the instance profile) unless both keys are set", () => {
    expect(awsCredentials({})).toBeUndefined();
    expect(awsCredentials({ AWS_ACCESS_KEY_ID: "AKIA1", AWS_SECRET_ACCESS_KEY: "s" })).toEqual({ accessKeyId: "AKIA1", secretAccessKey: "s" });
    expect(awsCredentials({ AWS_ACCESS_KEY_ID: "ASIA1", AWS_SECRET_ACCESS_KEY: "s", AWS_SESSION_TOKEN: "t" })).toEqual({ accessKeyId: "ASIA1", secretAccessKey: "s", sessionToken: "t" });
  });
});

describe("parseDbEnv", () => {
  it("needs only the database settings, and always needs them", () => {
    expect(paths({ APP_ENV: "production" }, parseDbEnv)).toEqual(["DATABASE_URL"]);
    expect(paths({ APP_ENV: "production", ...DB }, parseDbEnv)).toEqual([]);
    expect(problems({ APP_ENV: "production", ...DB }, parseDbEnv)).toEqual([]);
  });

  it("names the database settings in its message", () => {
    expect(() => parseDbEnv({})).toThrow(/^The server's database settings are not valid/);
  });
});

describe("parsePublicEnv", () => {
  it("checks the flags built into the browser bundle", () => {
    expect(paths({ NEXT_PUBLIC_VIEW_AS: "1", NEXT_PUBLIC_DEV_TOOLS: "0" }, parsePublicEnv)).toEqual([]);
    expect(paths({ NEXT_PUBLIC_VIEW_AS: "yes" }, parsePublicEnv)).toEqual(["NEXT_PUBLIC_VIEW_AS"]);
  });
});
