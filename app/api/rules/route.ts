import { authorize, authorizeFor, deny, readJson } from "@/lib/server/guard";
import { publishAll } from "@/lib/server/runtime";
import { ROUTE_IDS } from "@/lib/engine/rules";
import type { Route } from "@/lib/types";

/** Rule configuration, for roles that can open the Rules Engine. */
export async function GET() {
  const ctx = await authorize();
  if (ctx instanceof Response) return ctx;
  if (!ctx.perms.tabs.includes("rules")) return deny(403, "Your role cannot view the rules engine.");
  return Response.json({ rules: ctx.S.rules, canEdit: ctx.perms.rulesEdit });
}

/** Change one rule: { id, thr?, sev?, route?, on? }. Rules admin only. */
export async function PATCH(req: Request) {
  const ctx = await authorizeFor("rulesEdit");
  if (ctx instanceof Response) return ctx;
  const body = await readJson(req);
  const rule = ctx.S.rules.find(r => r.id === body.id);
  if (!rule) return deny(404, "Unknown rule.");
  const e = ctx.rt.engine;
  if (body.thr !== undefined) {
    const n = Number(body.thr);
    if (!Number.isFinite(n) || n < 1) return deny(400, "Threshold must be a number of at least 1.");
    e.setThr(rule.id, n);
  }
  if (body.sev !== undefined) {
    if (body.sev !== "warn" && body.sev !== "crit") return deny(400, "Severity must be warn or crit.");
    e.setSev(rule.id, body.sev);
  }
  if (body.route !== undefined) {
    if (!ROUTE_IDS.includes(body.route as Route)) return deny(400, "Unknown escalation route.");
    e.setRoute(rule.id, body.route as Route);
  }
  if (body.on !== undefined) {
    if (typeof body.on !== "boolean") return deny(400, "Enabled must be true or false.");
    e.setOn(rule.id, body.on);
  }
  publishAll();
  return Response.json({ rule });
}
