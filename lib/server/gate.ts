import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// The password wall in front of the whole console. One shared password (RTM_SITE_PASSWORD)
// unlocks a browser for GATE_MAX_AGE; proxy.ts turns every other request away until then.
// The cookie holds an HMAC keyed by the password, never the password itself, so changing the
// password locks every browser out again. Unset password = locked for everyone.

export const GATE_COOKIE = "rtm_gate";
/** One shift: a browser stays unlocked for 12 hours. */
export const GATE_MAX_AGE = 12 * 60 * 60;

const sitePassword = (): string => process.env.RTM_SITE_PASSWORD ?? "";

export const gateConfigured = (): boolean => sitePassword().length > 0;

/** The cookie value that proves a browser was unlocked with `password`. */
export const gateToken = (password: string): string => createHmac("sha256", password).update("rtm-gate-v1").digest("base64url");

/** Constant-time compare of two strings of any length. */
function same(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest(), hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function passwordMatches(attempt: string, password = sitePassword()): boolean {
  return password.length > 0 && same(attempt, password);
}

export function isUnlocked(cookie: string | undefined, password = sitePassword()): boolean {
  return password.length > 0 && !!cookie && same(cookie, gateToken(password));
}

/**
 * Where to go after unlocking: a path on this site only. Parsed as a URL rather than checked by
 * prefix, because browsers drop tabs and newlines from URLs ("/\t/evil" becomes "//evil").
 */
export function safeNext(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || /[\u0000-\u001f\\]/.test(next)) return "/console";
  try {
    const u = new URL(next, "http://local.invalid");
    return u.origin === "http://local.invalid" ? u.pathname + u.search + u.hash : "/console";
  } catch { return "/console"; }
}

// Wrong guesses, so the password cannot be guessed at speed. Per client, and also in total:
// the client key comes from X-Forwarded-For, which a caller can set to anything, so the global
// count is what holds against someone rotating it. Already-unlocked browsers are unaffected.
const MAX_FAILURES = 10;
const MAX_GLOBAL_FAILURES = 30;
const WINDOW_MS = 15 * 60 * 1000;
const ALL = "*";
type Count = { n: number; until: number };
const g = globalThis as typeof globalThis & { __rtmGateFailures?: Map<string, Count> };
const failures = (g.__rtmGateFailures ??= new Map());

function waitFor(key: string, max: number, now: number): number {
  const f = failures.get(key);
  return f && f.until > now && f.n >= max ? Math.ceil((f.until - now) / 1000) : 0;
}

/** Seconds until `client` may try again, or 0 when it may try now. */
export function lockedOutFor(client: string, now = Date.now()): number {
  return Math.max(waitFor(client, MAX_FAILURES, now), waitFor(ALL, MAX_GLOBAL_FAILURES, now));
}

export function recordFailure(client: string, now = Date.now()): void {
  for (const key of [client, ALL]) {
    const f = failures.get(key);
    if (!f || f.until <= now) failures.set(key, { n: 1, until: now + WINDOW_MS });
    else f.n++;
  }
}

/** A correct password clears that client's count; the global count runs out on its own. */
export const clearFailures = (client: string): void => { failures.delete(client); };

/** Tests only: forget every count. */
export const resetFailures = (): void => { failures.clear(); };
