import type { Kysely } from "kysely";
import type { DB } from "@/lib/db/schema";
import { defaultRules } from "@/lib/engine/rules";
import type { Rule, RuleId } from "@/lib/types";
import type { Store } from "./store";

/** Edits to one rule by one person within this long become one version, so typing a threshold is not a version per keystroke. */
export const FOLD_MS = 2000;
/** How long to wait before trying a failed write again. */
const RETRY_MS = 5000;

type Settings = Pick<Rule, "thr" | "unit" | "sev" | "route" | "on">;
interface PendingEdit { ruleId: RuleId; by: string | null; settings: Settings }

const settingsOf = (r: Rule): Settings => ({ thr: r.thr, unit: r.unit, sev: r.sev, route: r.route, on: r.on });

/**
 * Keeps records in PostgreSQL. Writes wait in a queue, in the order they happened, and are written
 * in one transaction; a failed write is tried again with the same records in the same order.
 */
export function postgresStore(db: Kysely<DB>, opts: { foldMs?: number; log?: (msg: string) => void } = {}): Store {
  const foldMs = opts.foldMs ?? FOLD_MS;
  const log = opts.log ?? (msg => console.error(msg));
  let queue: PendingEdit[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> = Promise.resolve();

  const schedule = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => { void flush(); }, ms);
    timer.unref?.();
  };

  async function write(batch: PendingEdit[]): Promise<void> {
    await db.transaction().execute(async tx => {
      for (const e of batch) {
        const current = await tx.selectFrom("rules_master as m")
          .innerJoin("rule_version as v", j => j.onRef("v.rule_id", "=", "m.rule_id").onRef("v.version", "=", "m.current_version"))
          .select(["m.current_version", "v.threshold", "v.unit", "v.severity", "v.route_id", "v.enabled"])
          .where("m.rule_id", "=", e.ruleId).forUpdate("m").executeTakeFirst();
        if (!current) throw new Error(`Rule ${e.ruleId} is not in the database: run npm run db:migrate.`);
        const s = e.settings;
        const same = Number(current.threshold) === s.thr && current.unit === s.unit && current.severity === s.sev && current.route_id === s.route && current.enabled === s.on;
        if (same) continue; // changed and changed back: nothing new to keep
        const version = current.current_version + 1;
        await tx.insertInto("rule_version").values({ rule_id: e.ruleId, version, threshold: s.thr, unit: s.unit, severity: s.sev, route_id: s.route, enabled: s.on, changed_by: e.by }).execute();
        await tx.updateTable("rules_master").set({ current_version: version }).where("rule_id", "=", e.ruleId).execute();
      }
    });
  }

  function flush(): Promise<void> {
    clearTimeout(timer);
    writing = writing.then(async () => {
      if (queue.length === 0) return;
      const batch = queue;
      queue = [];
      try {
        await write(batch);
      } catch (err) {
        queue = [...batch, ...queue];
        log(`Saving rule changes failed; trying again in ${RETRY_MS / 1000}s. ${err instanceof Error ? err.message : err}`);
        schedule(RETRY_MS);
      }
    });
    return writing;
  }

  return {
    kind: "postgres",

    async loadRules() {
      const rows = await db.selectFrom("rules_master as m")
        .innerJoin("rule_version as v", j => j.onRef("v.rule_id", "=", "m.rule_id").onRef("v.version", "=", "m.current_version"))
        .select(["m.rule_id", "v.threshold", "v.unit", "v.severity", "v.route_id", "v.enabled"])
        .execute();
      const byId = new Map(rows.map(r => [r.rule_id, r]));
      const missing = defaultRules().filter(d => !byId.has(d.id)).map(d => d.id);
      if (missing.length) throw new Error(`Rules missing from the database (${missing.join(", ")}): run npm run db:migrate.`);
      // Names and conditions come from the code; the editable settings from the database.
      return defaultRules().map(d => {
        const r = byId.get(d.id)!;
        return { ...d, thr: Number(r.threshold), unit: r.unit, sev: r.severity as Rule["sev"], route: r.route_id as Rule["route"], on: r.enabled };
      });
    },

    ruleChanged(rule, by = null) {
      const last = queue.at(-1);
      // Folded into the last edit while it is still waiting, if it was the same rule by the same person.
      if (last && last.ruleId === rule.id && last.by === by) last.settings = settingsOf(rule);
      else queue.push({ ruleId: rule.id, by, settings: settingsOf(rule) });
      schedule(foldMs);
    },

    flush,

    async close() {
      await flush();
      await db.destroy();
    },
  };
}
