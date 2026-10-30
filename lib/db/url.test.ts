import { describe, expect, it } from "vitest";
import { databaseUrl, isTestDatabase, pgSsl, schemaFromUrl, testDatabaseUrl, withSchema } from "./url";

const PARTS = { DB_HOST: "db.internal", DB_PORT: 5435, DB_NAME: "rtm_console", DB_USER: "rtm_app", DB_PASSWORD: "p@ss:w/rd#1?" };

describe("databaseUrl", () => {
  it("uses DATABASE_URL as it is when set, over the DB_* values", () => {
    expect(databaseUrl({ ...PARTS, DATABASE_URL: "postgres://u:p@elsewhere:5432/other" })).toBe("postgres://u:p@elsewhere:5432/other");
  });

  it("composes from DB_*, encoding the password", () => {
    const url = databaseUrl(PARTS);
    expect(url).toBe("postgres://rtm_app:p%40ss%3Aw%2Frd%231%3F@db.internal:5435/rtm_console");
    const u = new URL(url);
    expect(decodeURIComponent(u.password)).toBe(PARTS.DB_PASSWORD);
    expect(u.hostname).toBe("db.internal");
  });

  it("defaults the port to 5432", () => {
    expect(databaseUrl({ ...PARTS, DB_PORT: undefined })).toContain("@db.internal:5432/");
  });

  it("adds DB_SCHEMA as the search_path", () => {
    const url = databaseUrl({ ...PARTS, DB_SCHEMA: "alice" });
    expect(schemaFromUrl(url)).toBe("alice");
    expect(schemaFromUrl(databaseUrl({ DATABASE_URL: "postgres://u:p@h/db", DB_SCHEMA: "bob" }))).toBe("bob");
  });

  it("refuses to compose without every part", () => {
    expect(() => databaseUrl({ DB_HOST: "h" })).toThrow(/No database settings/);
  });
});

describe("schemaFromUrl", () => {
  it("reads the first schema in the search_path, or null", () => {
    expect(schemaFromUrl("postgres://u:p@h/db")).toBeNull();
    expect(schemaFromUrl("postgres://u:p@h/db?options=-c%20search_path%3Dteam_a")).toBe("team_a");
    expect(schemaFromUrl("postgres://u:p@h/db?options=-c+search_path%3Dteam_a,public")).toBe("team_a");
  });

  it("keeps other options when the schema is replaced", () => {
    const url = withSchema("postgres://u:p@h/db?options=-c%20statement_timeout%3D5000%20-c%20search_path%3Dold", "new");
    expect(schemaFromUrl(url)).toBe("new");
    expect(new URL(url).searchParams.get("options")).toBe("-c statement_timeout=5000 -c search_path=new");
  });
});

describe("testDatabaseUrl", () => {
  it("prefers TEST_DATABASE_URL", () => {
    expect(testDatabaseUrl("postgres://u:p@h/db", "postgres://u:p@h/elsewhere_test")).toBe("postgres://u:p@h/elsewhere_test");
  });

  it("uses <schema>_test when the main URL works in a schema", () => {
    const url = testDatabaseUrl(withSchema("postgres://u:p@h/db", "alice"));
    expect(schemaFromUrl(url)).toBe("alice_test");
    expect(new URL(url).pathname).toBe("/db");
  });

  it("otherwise uses the database <database>_test", () => {
    expect(new URL(testDatabaseUrl("postgres://u:p@h:5435/rtm_console")).pathname).toBe("/rtm_console_test");
  });

  it("tells a test database from any other", () => {
    expect(isTestDatabase("postgres://u:p@h/rtm_console_test")).toBe(true);
    expect(isTestDatabase("postgres://u:p@h/rtm_console")).toBe(false);
    expect(isTestDatabase(withSchema("postgres://u:p@h/rtm_console", "alice_test"))).toBe(true);
    expect(isTestDatabase(withSchema("postgres://u:p@h/rtm_console_test", "alice"))).toBe(false);
  });
});

describe("pgSsl", () => {
  it("verifies the server by default, and adds DB_CA_CERT to the usual authorities", () => {
    expect(pgSsl("verify-full")).toEqual({ rejectUnauthorized: true });
    const ssl = pgSsl("verify-full", "company.pem", () => "COMPANY-CA");
    expect(ssl && ssl.rejectUnauthorized).toBe(true);
    expect(ssl && ssl.ca?.at(-1)).toBe("COMPANY-CA");
    expect(ssl && ssl.ca!.length).toBeGreaterThan(1);
  });

  it("turns TLS off or stops verifying only when asked", () => {
    expect(pgSsl("disable")).toBe(false);
    expect(pgSsl("no-verify")).toEqual({ rejectUnauthorized: false });
  });
});
