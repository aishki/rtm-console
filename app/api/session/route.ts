import { authorize, deny, readJson } from "@/lib/server/guard";
import { resolveView } from "@/lib/engine/scope";
import { VIEW_AS, isRole, writeView } from "@/lib/server/session";
import { demoViewWho } from "@/lib/server/demo";

export async function GET() {
  const ctx = await authorize();
  if (ctx instanceof Response) return ctx;
  return Response.json({ view: ctx.view, viewAs: VIEW_AS });
}

/** Dev/admin "View as": switch the role and person this session is scoped to. */
export async function POST(req: Request) {
  const ctx = await authorize();
  if (ctx instanceof Response) return ctx;
  if (!VIEW_AS) return deny(403, "Role switching is disabled. Roles come from SSO.");
  const body = await readJson(req);
  if (!isRole(body.role)) return deny(400, "Unknown role.");
  // On the demo floor a bare role switch follows the cue agent: their own view, their lead, their manager.
  const who = typeof body.who === "string" ? body.who : demoViewWho(ctx.rt, body.role);
  const view = resolveView(ctx.S, { role: body.role, who });
  await writeView(view);
  return Response.json({ view });
}
