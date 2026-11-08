import { createHash } from "node:crypto";
import { type Kysely, type Transaction, sql } from "kysely";
import type { DB } from "@/lib/db/schema";
import { defaultRules } from "@/lib/engine/rules";
import { domainIdOf } from "@/lib/engine/format";
import type { QueueMapRow } from "@/lib/import/queueMap";
import { ORGS, type OrgId, isOrgId } from "@/lib/orgs";
import { queueKey } from "@/lib/queueStats";
import type { Role, Rule, RuleId } from "@/lib/types";
import { loadActiveOrg } from "@/lib/server/tokenStore";
import { readQueueMapFile } from "./files";
import type { RosterNames, SavedSubscription, Store } from "./store";

/** Edits to one rule by one person within this long become one version, so typing a threshold is not a version per keystroke. */
export const FOLD_MS = 2000;
/** How long to wait before trying a failed write again. */
const RETRY_MS = 5000;
/** Rows per INSERT: well under PostgreSQL's 65,535 parameters for the widest table here. */
const CHUNK = 1000;

type Settings = Pick<Rule, "thr" | "unit" | "sev" | "route" | "on">;

/** A write waiting in the queue. Each is written in its own transaction, in the order they happened. */
type Pending =
  | { kind: "rule"; ruleId: RuleId; by: string | null; settings: Settings }
  | { kind: "roster"; org: OrgId; roster: RosterNames }
  | { kind: "sub"; s: SavedSubscription }
  | { kind: "unsub"; endpoint: string }
  | { kind: "delivered"; endpoints: Set<string> }
  | { kind: "org"; org: OrgId };

const settingsOf = (r: Rule): Settings => ({ thr: r.thr, unit: r.unit, sev: r.sev, route: r.route, on: r.on });
const hashOf = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex");
const chunks = <T>(xs: T[]): T[][] => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** The org a queue map row's Org column names, as queueNamesFor() in lib/orgs.ts reads it. */
const orgNamed = (name: string | undefined): OrgId | null => (name ? ORGS.find(o => norm(o.name) === norm(name))?.id ?? null : null);

async function writeRule(tx: Transaction<DB>, e: Extract<Pending, { kind: "rule" }>): Promise<void> {
  const current = await tx.selectFrom("rules_master as m")
    .innerJoin("rule_version as v", j => j.onRef("v.rule_id", "=", "m.rule_id").onRef("v.version", "=", "m.current_version"))
    .select(["m.current_version", "v.threshold", "v.unit", "v.severity", "v.route_id", "v.enabled"])
    .where("m.rule_id", "=", e.ruleId).forUpdate("m").executeTakeFirst();
  if (!current) throw new Error(`Rule ${e.ruleId} is not in the database: run npm run db:migrate.`);
  const s = e.settings;
  const same = Number(current.threshold) === s.thr && current.unit === s.unit && current.severity === s.sev && current.route_id === s.route && current.enabled === s.on;
  if (same) return; // changed and changed back: nothing new to keep
  const version = current.current_version + 1;
  await tx.insertInto("rule_version").values({ rule_id: e.ruleId, version, threshold: s.thr, unit: s.unit, severity: s.sev, route_id: s.route, enabled: s.on, changed_by: e.by }).execute();
  await tx.updateTable("rules_master").set({ current_version: version }).where("rule_id", "=", e.ruleId).execute();
}

/**
 * Each person's LOB from the mapping: the LOB with most of their queues, ties by name. Null when
 * none of their queues is mapped. A mapping row with no org counts for every org.
 */
async function refreshLobs(tx: Transaction<DB>, org?: OrgId): Promise<void> {
  await sql`
    UPDATE person p SET lob_id = (
      SELECT m.lob_id FROM queue_member qm
      JOIN queue q ON q.queue_id = qm.queue_id
      JOIN queue_lob_map m ON m.queue_key = q.name_key AND (m.org_id IS NULL OR m.org_id = q.org_id)
      JOIN lob l ON l.lob_id = m.lob_id
      WHERE qm.person_id = p.person_id
      GROUP BY m.lob_id, l.name
      ORDER BY count(*) DESC, l.name
      LIMIT 1
    )
    ${org ? sql`WHERE p.org_id = ${org}` : sql``}`.execute(tx);
}

/** The tower, sub_tower and lob rows for these names, made where missing. Never deleted: overrides point at them. */
async function lobIds(tx: Transaction<DB>, rows: QueueMapRow[]): Promise<Map<string, number>> {
  const towers = [...new Set(rows.map(r => r.tower))];
  if (towers.length) await tx.insertInto("tower").values(towers.map(name => ({ name }))).onConflict(oc => oc.column("name").doNothing()).execute();
  const towerId = new Map((await tx.selectFrom("tower").select(["tower_id", "name"]).execute()).map(t => [t.name, t.tower_id]));

  const subKey = (towerId: number, name: string) => `${towerId}\u0000${name}`;
  const subs = new Map<string, { tower_id: number; name: string }>();
  for (const r of rows) { const t = towerId.get(r.tower)!; subs.set(subKey(t, r.subTower), { tower_id: t, name: r.subTower }); }
  if (subs.size) await tx.insertInto("sub_tower").values([...subs.values()]).onConflict(oc => oc.columns(["tower_id", "name"]).doNothing()).execute();
  const subId = new Map((await tx.selectFrom("sub_tower").select(["sub_tower_id", "tower_id", "name"]).execute()).map(s => [subKey(s.tower_id, s.name), s.sub_tower_id]));

  const lobKey = (subId: number, name: string) => `${subId}\u0000${name}`;
  const lobs = new Map<string, { sub_tower_id: number; name: string }>();
  const rowSub = (r: QueueMapRow) => subId.get(subKey(towerId.get(r.tower)!, r.subTower))!;
  for (const r of rows) { const s = rowSub(r); lobs.set(lobKey(s, r.lob), { sub_tower_id: s, name: r.lob }); }
  if (lobs.size) await tx.insertInto("lob").values([...lobs.values()]).onConflict(oc => oc.columns(["sub_tower_id", "name"]).doNothing()).execute();
  const lobId = new Map((await tx.selectFrom("lob").select(["lob_id", "sub_tower_id", "name"]).execute()).map(l => [lobKey(l.sub_tower_id, l.name), l.lob_id]));

  const out = new Map<string, number>();
  for (const r of rows) out.set(queueKey(r.queue), lobId.get(lobKey(rowSub(r), r.lob))!);
  return out;
}

async function writeQueueMap(tx: Transaction<DB>, rows: QueueMapRow[], by: string | null, action: string): Promise<void> {
  const before = await tx.selectFrom("queue_lob_map").select(sql<string>`count(*)`.as("n")).executeTakeFirstOrThrow();
  const ids = await lobIds(tx, rows);
  await tx.deleteFrom("queue_lob_map").execute();
  const values = rows.map((r, i) => ({
    queue_key: queueKey(r.queue), queue_name: r.queue, lob_id: ids.get(queueKey(r.queue))!,
    region: r.region ?? null, org_name: r.org ?? null, org_id: orgNamed(r.org), position: i,
  }));
  for (const part of chunks(values)) await tx.insertInto("queue_lob_map").values(part).execute();
  await refreshLobs(tx);
  await tx.insertInto("audit_event").values({
    actor_id: by, action, target_type: "queue_lob_map", target_id: null,
    before: JSON.stringify({ queues: Number(before.n) }),
    after: JSON.stringify({ queues: rows.length, towers: [...new Set(rows.map(r => r.tower))] }),
  }).execute();
}

/**
 * An org's roster as rows: its watched queues, its people (agents and the leaders above them) and
 * who is on which queue. People and queues no longer on it are kept, marked as not on it.
 */
async function writeRoster(tx: Transaction<DB>, org: OrgId, r: RosterNames): Promise<void> {
  // Without Genesys queue IDs (a roster saved before they were sent) there is nothing to key queues by.
  if (!r.queues?.length) return;
  const agents = r.agents.filter((a): a is typeof a & { uid: string } => !!a.uid);

  // Queues: the first queue with a name is the one its members are listed under.
  const idByName = new Map<string, string>();
  for (const q of r.queues) if (!idByName.has(q.name)) idByName.set(q.name, q.id);
  const queueRows = r.queues.map((q, i) => ({ queue_id: q.id, org_id: org, name: q.name, name_key: queueKey(q.name), division: q.division ?? null, watched: true, position: i }));
  await tx.updateTable("queue").set({ watched: false, position: null }).where("org_id", "=", org).execute();
  for (const part of chunks(queueRows)) {
    await tx.insertInto("queue").values(part).onConflict(oc => oc.column("queue_id").doUpdateSet(eb => ({
      org_id: eb.ref("excluded.org_id"), name: eb.ref("excluded.name"), name_key: eb.ref("excluded.name_key"),
      division: sql<string | null>`coalesce(excluded.division, queue.division)`, watched: true, position: eb.ref("excluded.position"), last_seen: sql`now()`,
    }))).execute();
  }

  // People: everyone on the roster, and the leaders in the reporting lines.
  const people = new Map<string, { name: string; supervisor?: string | null; pos: number | null; lastLogin?: string }>();
  agents.forEach((a, i) => people.set(a.uid, { name: a.name, pos: i, lastLogin: a.lastLogin }));
  for (const p of r.people ?? []) {
    const known = people.get(p.uid);
    people.set(p.uid, { name: known?.name ?? p.name, supervisor: p.supervisor, pos: known?.pos ?? null, lastLogin: known?.lastLogin });
  }
  const lines = !!r.people;
  const personRows = [...people].map(([uid, p]) => ({
    person_id: uid, org_id: org, name: p.name, domain_id: domainIdOf(p.name) || null,
    // A supervisor outside these people is not kept: the foreign key needs their row.
    supervisor_id: p.supervisor && people.has(p.supervisor) ? p.supervisor : null,
    lines_at: lines && p.supervisor !== undefined ? sql<Date>`now()` : null,
    active: true, roster_pos: p.pos, last_login_at: p.lastLogin ?? null,
  }));
  await tx.updateTable("person").set({ active: false, roster_pos: null }).where("org_id", "=", org).execute();
  for (const part of chunks(personRows)) {
    await tx.insertInto("person").values(part).onConflict(oc => oc.column("person_id").doUpdateSet(eb => ({
      org_id: eb.ref("excluded.org_id"), name: eb.ref("excluded.name"), domain_id: eb.ref("excluded.domain_id"),
      // Without lines in this roster, the ones found before stay.
      supervisor_id: lines ? eb.ref("excluded.supervisor_id") : eb.ref("person.supervisor_id"),
      lines_at: lines ? eb.ref("excluded.lines_at") : eb.ref("person.lines_at"),
      active: true, roster_pos: eb.ref("excluded.roster_pos"), last_seen: sql`now()`,
      // A roster without login times keeps the last one known.
      last_login_at: sql<Date | null>`coalesce(excluded.last_login_at, person.last_login_at)`,
    }))).execute();
  }

  // Membership: each agent's home queue (their team) is position 0, then the others in roster order.
  const queuesOf = new Map<string, string[]>();
  for (const a of agents) { const id = idByName.get(a.team); if (id) queuesOf.set(a.uid, [id]); }
  for (const [name, uids] of Object.entries(r.members ?? {})) {
    const id = idByName.get(name);
    if (!id) continue;
    for (const uid of uids) {
      if (!people.has(uid)) continue;
      const list = queuesOf.get(uid) ?? [];
      if (!list.includes(id)) list.push(id);
      queuesOf.set(uid, list);
    }
  }
  const memberRows = [...queuesOf].flatMap(([uid, ids]) => ids.map((queue_id, position) => ({ queue_id, person_id: uid, position })));
  await tx.deleteFrom("queue_member").where("queue_id", "in", tx.selectFrom("queue").select("queue_id").where("org_id", "=", org)).execute();
  for (const part of chunks(memberRows)) await tx.insertInto("queue_member").values(part).execute();

  await refreshLobs(tx, org);
}

async function readRoster(db: Kysely<DB>, org: OrgId): Promise<RosterNames | null> {
  const queues = await db.selectFrom("queue").select(["queue_id", "name", "division"]).where("org_id", "=", org).where("watched", "=", true).orderBy("position").execute();
  const agents = await db.selectFrom("person").select(["person_id", "name", "last_login_at"]).where("org_id", "=", org).where("active", "=", true).where("roster_pos", "is not", null).orderBy("roster_pos").execute();
  if (!queues.length || !agents.length) return null;
  const membership = await db.selectFrom("queue_member as qm").innerJoin("queue as q", "q.queue_id", "qm.queue_id").innerJoin("person as p", "p.person_id", "qm.person_id")
    .select(["q.name", "qm.person_id", "qm.position"]).where("q.org_id", "=", org).where("q.watched", "=", true).where("p.roster_pos", "is not", null)
    .orderBy("q.position").orderBy("p.roster_pos").execute();
  const home = new Map(membership.filter(m => m.position === 0).map(m => [m.person_id, m.name]));
  const members: Record<string, string[]> = Object.fromEntries(queues.map(q => [q.name, [] as string[]]));
  for (const m of membership) members[m.name].push(m.person_id);
  const lined = await db.selectFrom("person").select(["person_id", "name", "supervisor_id"]).where("org_id", "=", org).where("active", "=", true).where("lines_at", "is not", null).execute();
  return {
    org: queues.map(q => ({ team: q.name, tl: "", mgr: "", lob: q.name })),
    agents: agents.map(a => ({ uid: a.person_id, name: a.name, team: home.get(a.person_id) ?? queues[0].name, ...(a.last_login_at && { lastLogin: a.last_login_at.toISOString() }) })),
    members,
    ...(lined.length && { people: lined.map(p => ({ uid: p.person_id, name: p.name, supervisor: p.supervisor_id })) }),
    queues: queues.map(q => ({ id: q.queue_id, name: q.name, ...(q.division !== null && { division: q.division }) })),
  };
}

async function readQueueMap(db: Kysely<DB>): Promise<QueueMapRow[]> {
  const rows = await db.selectFrom("queue_lob_map as m").innerJoin("lob as l", "l.lob_id", "m.lob_id")
    .innerJoin("sub_tower as s", "s.sub_tower_id", "l.sub_tower_id").innerJoin("tower as t", "t.tower_id", "s.tower_id")
    .select(["t.name as tower", "s.name as subTower", "l.name as lob", "m.queue_name", "m.region", "m.org_name"]).orderBy("m.position").execute();
  return rows.map(r => ({ tower: r.tower, subTower: r.subTower, lob: r.lob, queue: r.queue_name, ...(r.region !== null && { region: r.region }), ...(r.org_name !== null && { org: r.org_name }) }));
}

/**
 * Keeps records in PostgreSQL. Writes wait in a queue, in the order they happened, and each is
 * written in its own transaction; a failed write is tried again, with the ones after it, in the same order.
 * `importDir` is where the files from before the database are read once, while their tables are empty.
 */
export function postgresStore(db: Kysely<DB>, opts: { foldMs?: number; log?: (msg: string) => void; importDir?: string | null } = {}): Store {
  const foldMs = opts.foldMs ?? FOLD_MS;
  const log = opts.log ?? (msg => console.error(msg));
  const queue: Pending[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> = Promise.resolve();
  /** The write going to the database right now, which must not be changed under it. */
  let inFlight: Pending | null = null;

  const schedule = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => { void flush(); }, ms);
    timer.unref?.();
  };

  const writeOne = (e: Pending) => db.transaction().execute(async tx => {
    switch (e.kind) {
      case "rule": return writeRule(tx, e);
      case "roster": return writeRoster(tx, e.org, e.roster);
      case "sub": {
        const { sub, view, userAgent } = e.s;
        const row = { endpoint_hash: hashOf(sub.endpoint), endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, person_id: view.who, role: view.role, user_agent: userAgent ?? null };
        await tx.insertInto("push_subscription").values(row).onConflict(oc => oc.column("endpoint_hash").doUpdateSet({
          p256dh: row.p256dh, auth: row.auth, person_id: row.person_id, role: row.role, user_agent: row.user_agent, updated_at: sql`now()`,
        })).execute();
        return;
      }
      case "delivered": {
        await tx.updateTable("push_subscription").set({ last_success_at: sql`now()` }).where("endpoint_hash", "in", [...e.endpoints].map(hashOf)).execute();
        return;
      }
      case "unsub": { await tx.deleteFrom("push_subscription").where("endpoint_hash", "=", hashOf(e.endpoint)).execute(); return; }
      case "org": {
        // Two statements: the one-on-screen index would refuse a moment with two orgs on screen.
        await tx.updateTable("genesys_org").set({ on_screen: false }).where("on_screen", "=", true).execute();
        await tx.updateTable("genesys_org").set({ on_screen: true }).where("org_id", "=", e.org).execute();
      }
    }
  });

  const describe = (e: Pending) => (e.kind === "rule" ? "rule changes" : e.kind === "roster" ? `the ${e.org} roster` : e.kind === "org" ? "the org on screen" : "desktop alert subscriptions");

  function flush(): Promise<void> {
    clearTimeout(timer);
    writing = writing.then(async () => {
      while (queue.length) {
        const e = (inFlight = queue[0]);
        try {
          await writeOne(e);
          queue.shift();
        } catch (err) {
          log(`Saving ${describe(e)} failed; trying again in ${RETRY_MS / 1000}s. ${err instanceof Error ? err.message : err}`);
          schedule(RETRY_MS);
          return;
        } finally {
          inFlight = null;
        }
      }
    });
    return writing;
  }

  const enqueue = (e: Pending, ms = 0) => { queue.push(e); schedule(ms); };

  /** The files from before there was a database, read once while their tables are empty. */
  async function importFiles(): Promise<void> {
    if (opts.importDir === null) return;
    const empty = await db.selectFrom("queue_lob_map").select("queue_key").limit(1).executeTakeFirst();
    if (empty) return;
    const rows = readQueueMapFile(opts.importDir);
    if (!rows.length) return;
    const seen = new Set<string>();
    const one = rows.filter(r => { const k = queueKey(r.queue); if (seen.has(k)) return false; seen.add(k); return true; });
    await db.transaction().execute(tx => writeQueueMap(tx, one, null, "queue_lob_map.import"));
    log(`Imported the queue map from .rtm/queue-map.json: ${one.length} queues.`);
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
      if (last?.kind === "rule" && last !== inFlight && last.ruleId === rule.id && last.by === by) last.settings = settingsOf(rule);
      else queue.push({ kind: "rule", ruleId: rule.id, by, settings: settingsOf(rule) });
      schedule(foldMs);
    },

    async loadBoot() {
      await importFiles();
      const queueMap = await readQueueMap(db);
      const rosters: Partial<Record<OrgId, RosterNames | null>> = {};
      for (const o of ORGS) rosters[o.id] = await readRoster(db, o.id);
      const subs = await db.selectFrom("push_subscription").select(["endpoint", "p256dh", "auth", "person_id", "role", "user_agent"]).execute();
      const shown = await db.selectFrom("genesys_org").select("org_id").where("on_screen", "=", true).executeTakeFirst();
      return {
        queueMap, rosters,
        subscriptions: subs.map(s => ({ sub: { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, view: { role: s.role as Role, who: s.person_id }, ...(s.user_agent !== null && { userAgent: s.user_agent }) })),
        // Before the database knew it, the org on screen was in .rtm/genesys-org.
        ...(shown && isOrgId(shown.org_id) ? { activeOrg: shown.org_id } : opts.importDir !== null ? { activeOrg: loadActiveOrg(opts.importDir) } : {}),
      };
    },

    async saveQueueMap(rows, by) {
      await flush(); // anything waiting goes first, so the order stays as it happened
      await db.transaction().execute(tx => writeQueueMap(tx, rows, by, "queue_lob_map.upload"));
    },

    rosterChanged(org, roster) {
      // Only the latest roster for an org matters: one still waiting is replaced where it stands.
      const waiting = queue.findIndex(e => e !== inFlight && e.kind === "roster" && e.org === org);
      if (waiting >= 0) queue[waiting] = { kind: "roster", org, roster };
      else enqueue({ kind: "roster", org, roster }, 1000);
    },
    subscriptionSaved(s) { enqueue({ kind: "sub", s }); },
    subscriptionDelivered(endpoint) {
      // Deliveries are many and only the time matters: they gather in one waiting write.
      const waiting = queue.find((e): e is Extract<Pending, { kind: "delivered" }> => e !== inFlight && e.kind === "delivered");
      if (waiting) waiting.endpoints.add(endpoint);
      else enqueue({ kind: "delivered", endpoints: new Set([endpoint]) }, 30_000);
    },
    subscriptionRemoved(endpoint) { enqueue({ kind: "unsub", endpoint }); },
    activeOrgChanged(org) { enqueue({ kind: "org", org }); },

    flush,

    async close() {
      await flush();
      await db.destroy();
    },
  };
}
