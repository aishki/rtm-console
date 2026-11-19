import { authorizeFor, deny, readJson } from "@/lib/server/guard";
import { demoCue, demoFloor } from "@/lib/server/runtime";
import { cueAgentName } from "@/lib/server/demo";

/**
 * A presenter's cue on the demo floor: { action: "next" | "reset" }. "next" moves the cue agent to their
 * next Overbreak strike (nudge, team lead, operations and an incident); "reset" picks a fresh cue agent.
 * Admin only, and only while the demo floor is on and warmed.
 */
export async function POST(req: Request) {
  const ctx = await authorizeFor("feed");
  if (ctx instanceof Response) return ctx;
  const { action } = await readJson(req);
  if (action !== "next" && action !== "reset") return deny(400, "Unknown cue.");
  const res = demoCue(action);
  if (!res) return deny(409, "The demo floor is not on, or is still preparing the shift.");
  // The breach shows on the floor's next second; the call-out fires on the one after.
  return Response.json({ cueAgent: cueAgentName(demoFloor()!), strikes: res.strikes });
}
