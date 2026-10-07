import { authorize, deny } from "@/lib/server/guard";
import { VIEW_AS } from "@/lib/server/session";
import type { AgentState } from "@/lib/types";

/** Dev/admin "View as": every agent's current state, for the person picker. Like the people directory, it is not scoped. */
export async function GET() {
  const ctx = await authorize();
  if (ctx instanceof Response) return ctx;
  if (!VIEW_AS) return deny(403, "Role switching is disabled. Roles come from SSO.");
  const states: Record<string, AgentState> = {};
  for (const a of ctx.S.agents) states[a.name] = a.state;
  return Response.json({ states });
}
