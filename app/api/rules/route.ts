import { authorize, authorizeFor, deny, readJson } from "@/lib/server/guard";
import { publishAll } from "@/lib/server/runtime";
import { store } from "@/lib/server/store";
import { loadQueueMap } from "@/lib/server/queueMapStore";
import { ROUTE_IDS } from "@/lib/engine/rules";
import { type OverridePatch, placesIn, samePlace } from "@/lib/engine/overrides";
import type { Place, Route, Rule } from "@/lib/types";

/** Rule configuration, for roles that can open the Rules Engine. */
export async function GET() {
  const ctx = await authorize();
  if (ctx instanceof Response) return ctx;
  if (!ctx.perms.tabs.includes("rules")) return deny(403, "Your role cannot view the rules engine.");
  return Response.json({ rules: ctx.S.rules, canEdit: ctx.perms.rulesEdit });
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Change one rule: { id, thr?, sev?, route?, on? }. Rules admin only.
 * With scope: { tower, subTower?, lob? } it changes the rule's override for that Tower, Sub-Tower or
 * LOB instead, and null in a setting takes it back to the level above.
 */
export async function PATCH(req: Request) {
  const ctx = await authorizeFor("rulesEdit");
  if (ctx instanceof Response) return ctx;
  const body = await readJson(req);
  const rule = ctx.S.rules.find(r => r.id === body.id);
  if (!rule) return deny(404, "Unknown rule.");
  if (body.scope !== undefined) return patchOverride(ctx, rule, body);

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
  // A new rule version and an audit entry, saved shortly after (quick edits become one).
  store().ruleChanged(rule, ctx.view);
  publishAll();
  return Response.json({ rule });
}

type Ctx = Exclude<Awaited<ReturnType<typeof authorizeFor>>, Response>;

function patchOverride(ctx: Ctx, rule: Rule, body: Record<string, unknown>): Response {
  if (rule.type === "system") return deny(400, "A system rule applies to the whole platform: it cannot differ by Tower, Sub-Tower or LOB.");
  const s = (body.scope ?? {}) as Record<string, unknown>;
  const place: Place = { tower: text(s.tower), subTower: text(s.subTower), lob: text(s.lob) };
  if (!place.tower) return deny(400, "Choose a Tower.");
  if (place.lob && !place.subTower) return deny(400, "A LOB needs its Sub-Tower.");
  if (!placesIn(loadQueueMap()).some(p => samePlace(p, place))) return deny(400, "That Tower, Sub-Tower or LOB is not in the queue mapping.");

  const patch: OverridePatch = {};
  if (body.thr !== undefined) {
    if (body.thr === null) patch.thr = null;
    else {
      const n = Number(body.thr);
      if (!Number.isFinite(n) || n < 1) return deny(400, "Threshold must be a number of at least 1.");
      patch.thr = n;
    }
  }
  if (body.sev !== undefined) {
    if (body.sev !== null && body.sev !== "warn" && body.sev !== "crit") return deny(400, "Severity must be warn or crit.");
    patch.sev = body.sev;
  }
  if (body.route !== undefined) {
    if (body.route !== null && !ROUTE_IDS.includes(body.route as Route)) return deny(400, "Unknown escalation route.");
    patch.route = body.route as Route | null;
  }
  if (body.on !== undefined) {
    if (body.on !== null && typeof body.on !== "boolean") return deny(400, "Enabled must be true, false or null.");
    patch.on = body.on;
  }

  const override = ctx.rt.engine.setOverride(rule.id, place, patch);
  // A new override version, saved shortly after (quick edits become one). No settings left removes it.
  store().overrideChanged(rule.id, override ?? place, ctx.view);
  publishAll();
  return Response.json({ rule, override });
}
