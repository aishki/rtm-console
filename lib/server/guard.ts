import type { Perms, View } from "@/lib/types";
import type { EngineState } from "@/lib/engine/escalation";
import { PERMS, resolveView } from "@/lib/engine/scope";
import { type Runtime, floorSource, runtimeFor } from "./runtime";
import { readSession } from "./session";

export interface Ctx { sid: string; view: View; perms: Perms; rt: Runtime; S: EngineState }

export const deny = (status: number, error: string): Response => Response.json({ error }, { status });

/** Identify the caller and resolve their span. Every API route starts here. */
export async function authorize(): Promise<Ctx | Response> {
  const session = await readSession();
  if (!session) return deny(401, "Not signed in.");
  const rt = runtimeFor(session.sid);
  const view = resolveView(rt.engine.S, session.view);
  return { sid: session.sid, view, perms: PERMS[view.role], rt, S: rt.engine.S };
}

type Flag = "rulesEdit" | "invAct" | "export" | "ackAll" | "ir" | "replay" | "feed";

/** Authorize and require one PERMS flag. */
export async function authorizeFor(flag: Flag): Promise<Ctx | Response> {
  const ctx = await authorize();
  if (ctx instanceof Response) return ctx;
  return ctx.perms[flag] ? ctx : deny(403, "Your role does not allow this action.");
}

/** Authorize a floor-data import. Imports feed the replay, which is off while the floor is on the live Genesys feed. */
export async function authorizeImport(): Promise<Ctx | Response> {
  const ctx = await authorizeFor("replay");
  if (ctx instanceof Response) return ctx;
  return floorSource() === "gencloud" ? deny(403, "Importing floor data is turned off on the live Genesys feed.") : ctx;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch { return {}; }
}
