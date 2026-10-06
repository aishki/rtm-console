import { cookies } from "next/headers";
import type { Role, View } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/engine/rules";

/**
 * Dev/admin flag for the "View as" selector. In production the role and span must come from
 * the SSO session: replace `readSession` with a lookup of the signed-in user.
 */
export const VIEW_AS = process.env.NEXT_PUBLIC_VIEW_AS === "1";

const VIEW_COOKIE = "rtm_view";
const SID_COOKIE = "rtm_sid";
const COOKIE = { path: "/", sameSite: "lax", httpOnly: true } as const;

export const isRole = (x: unknown): x is Role => typeof x === "string" && x in ROLE_LABEL;

export interface Session { sid: string; view: View }

/** The caller's identity, or null when nobody is signed in. Only usable in route handlers. */
export async function readSession(): Promise<Session | null> {
  if (!VIEW_AS) return null; // TODO(SSO): resolve role and span from the identity provider.
  const jar = await cookies();
  let sid = jar.get(SID_COOKIE)?.value;
  if (!sid) { sid = crypto.randomUUID(); jar.set(SID_COOKIE, sid, COOKIE); }
  const [role, who] = (jar.get(VIEW_COOKIE)?.value ?? "").split(":");
  return { sid, view: { role: isRole(role) ? role : "admin", who: who ? decodeURIComponent(who) : null } };
}

export async function writeView(view: View): Promise<void> {
  (await cookies()).set(VIEW_COOKIE, `${view.role}:${encodeURIComponent(view.who ?? "")}`, COOKIE);
}
