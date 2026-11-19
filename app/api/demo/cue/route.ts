import { authorize, deny, readJson } from "@/lib/server/guard";
import { demoCue, demoFloor } from "@/lib/server/runtime";
import { canCue, cueAgentName } from "@/lib/server/demo";
import { VIEW_AS } from "@/lib/server/session";

/**
 * A presenter's cue on the demo floor: { action: "next" | "reset" }. "next" moves the cue agent to their
 * next Overbreak strike (nudge, team lead, operations and an incident); "reset" picks a fresh cue agent.
 * Admin, or any view while "View as" is on; in an agent's view the cue moves that agent. Only while the
 * demo floor is on and warmed.
 */
export async function POST(req: Request) {
  const ctx = await authorize();
  if (ctx instanceof Response) return ctx;
  // An Admin off the demo floor gets the 409 below; anyone else without the keys is refused here.
  if (!ctx.perms.feed && !canCue(ctx.rt, ctx.perms, VIEW_AS)) return deny(403, "Your role does not allow this action.");
  const { action } = await readJson(req);
  if (action !== "next" && action !== "reset") return deny(400, "Unknown cue.");
  const res = demoCue(action, ctx.view.role === "agent" ? ctx.view.who : null);
  if (!res) return deny(409, "The demo floor is not on, or is still preparing the shift.");
  // The breach shows on the floor's next second; the call-out fires on the one after.
  return Response.json({ cueAgent: cueAgentName(demoFloor()!), strikes: res.strikes });
}
