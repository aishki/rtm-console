import { cookies } from "next/headers";
import { deny, readJson } from "@/lib/server/guard";
import { GATE_COOKIE, GATE_MAX_AGE, clearFailures, gateConfigured, gateToken, lockedOutFor, passwordMatches, recordFailure, safeNext } from "@/lib/server/gate";

/** Unlock this browser: { password, next? } → sets the unlock cookie and says where to go. */
export async function POST(req: Request) {
  if (!gateConfigured()) return deny(503, "The console password is not set on the server (RTM_SITE_PASSWORD).");
  // The right-most entry is the one our own reverse proxy appended; the left ones are whatever the
  // caller sent. Without a proxy the whole header is the caller's, which the global count in
  // lib/server/gate.ts covers.
  const client = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "local";
  const wait = lockedOutFor(client);
  if (wait) return deny(429, `Too many wrong attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`);
  const body = await readJson(req);
  const password = typeof body.password === "string" ? body.password : "";
  if (!passwordMatches(password)) {
    recordFailure(client);
    return deny(401, "Wrong password.");
  }
  clearFailures(client);
  const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  (await cookies()).set(GATE_COOKIE, gateToken(password), { path: "/", httpOnly: true, sameSite: "lax", secure, maxAge: GATE_MAX_AGE });
  return Response.json({ ok: true, next: safeNext(body.next) });
}
