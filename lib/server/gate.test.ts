import { describe, expect, it } from "vitest";
import { clearFailures, gateToken, isUnlocked, lockedOutFor, passwordMatches, recordFailure, resetFailures, safeNext } from "./gate";

const PW = "Sample#Pass1";

describe("password wall", () => {
  it("accepts only the exact password", () => {
    expect(passwordMatches("Sample#Pass1", PW)).toBe(true);
    expect(passwordMatches("sample#pass1", PW)).toBe(false);
    expect(passwordMatches("Sample", PW)).toBe(false);
    expect(passwordMatches("", PW)).toBe(false);
  });

  it("stays locked for everyone while no password is configured", () => {
    expect(passwordMatches("", "")).toBe(false);
    expect(passwordMatches("anything", "")).toBe(false);
    expect(isUnlocked(gateToken(""), "")).toBe(false);
  });

  it("unlocks only with the cookie made from the current password", () => {
    expect(isUnlocked(gateToken(PW), PW)).toBe(true);
    expect(isUnlocked(undefined, PW)).toBe(false);
    expect(isUnlocked(PW, PW)).toBe(false);
    // Changing the password locks every browser out again.
    expect(isUnlocked(gateToken(PW), "new password")).toBe(false);
  });

  it("only sends people on to a path on this site", () => {
    expect(safeNext("/ledger?x=1")).toBe("/ledger?x=1");
    expect(safeNext("https://evil.example")).toBe("/console");
    expect(safeNext("//evil.example")).toBe("/console");
    expect(safeNext("/\\evil.example")).toBe("/console");
    // Browsers drop tabs and newlines, which would turn these into "//evil.example".
    expect(safeNext("/\t/evil.example")).toBe("/console");
    expect(safeNext("/\n/evil.example")).toBe("/console");
    expect(safeNext(undefined)).toBe("/console");
  });

  it("locks a client out after ten wrong guesses, for the rest of the window", () => {
    resetFailures();
    const client = "test-client", now = 1_000_000;
    for (let i = 0; i < 9; i++) recordFailure(client, now);
    expect(lockedOutFor(client, now)).toBe(0);
    recordFailure(client, now);
    expect(lockedOutFor(client, now)).toBe(15 * 60);
    expect(lockedOutFor(client, now + 15 * 60 * 1000)).toBe(0);
    clearFailures(client);
  });

  it("pauses every attempt after thirty wrong guesses in total, however the client is named", () => {
    resetFailures();
    const now = 1_000_000;
    for (let i = 0; i < 30; i++) recordFailure(`spoofed-${i}`, now);
    expect(lockedOutFor("someone-new", now)).toBe(15 * 60);
    expect(lockedOutFor("someone-new", now + 15 * 60 * 1000)).toBe(0);
    resetFailures();
  });
});
