import { type Kysely, type Transaction, sql } from "kysely";
import type { DB } from "@/lib/db/schema";
import type { DayCalls } from "@/lib/engine/record";
import type { OrgId } from "@/lib/orgs";
import type { SourceEvent } from "./store";

// Phase 3: the day's raw Genesys updates in source_event_stream, written through the store's queue,
// emptied at midnight Eastern, and read back at start-up for the day's calls.

/** Rows per INSERT: 7 columns each, well under PostgreSQL's 65,535 parameters. */
const CHUNK = 2000;

export async function writeEvents(tx: Transaction<DB>, rows: SourceEvent[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await tx.insertInto("source_event_stream").values(rows.slice(i, i + CHUNK).map(e => ({
      org_id: e.org, event_ts: e.at, entity_type: e.entityType, entity_id: e.entityId, metric_name: e.metric, metric_value: e.value,
      event_payload: e.payload === undefined ? null : JSON.stringify(e.payload),
    }))).execute();
  }
}

/**
 * Empty the events from before `since` (a floor midnight). TRUNCATE when every row is older, which
 * is instant and gives the space back; when another org's floor has already written events for the
 * new day, only the old rows are deleted, so they are kept.
 */
export async function clearEvents(tx: Transaction<DB>, since: Date): Promise<void> {
  const old = await tx.selectFrom("source_event_stream").select("event_id").where("event_ts", "<", since).limit(1).executeTakeFirst();
  if (!old) return;
  const newer = await tx.selectFrom("source_event_stream").select("event_id").where("event_ts", ">=", since).limit(1).executeTakeFirst();
  if (newer) await tx.deleteFrom("source_event_stream").where("event_ts", "<", since).execute();
  else await sql`TRUNCATE source_event_stream`.execute(tx);
}

/**
 * Each org's agents' calls since `since` (today's floor midnight): calls and transfers from the call
 * ends, their average length, and short calls from today's short-call call-outs.
 */
export async function readDayCalls(db: Kysely<DB>, today: string, since: Date): Promise<Partial<Record<OrgId, Record<string, DayCalls>>>> {
  const ends = await db.selectFrom("source_event_stream")
    .select([
      "org_id", "entity_id",
      sql<string>`count(*)`.as("calls"),
      sql<string>`count(*) FILTER (WHERE (event_payload->'callEnded'->>'transferred')::boolean)`.as("transfers"),
      sql<string | null>`avg((event_payload->'callEnded'->>'durationSec')::numeric)`.as("aht"),
    ])
    .where("metric_name", "=", "call.end").where("entity_type", "=", "agent").where("event_ts", ">=", since)
    .groupBy(["org_id", "entity_id"]).execute();
  const shorts = await db.selectFrom("monitoring_instance as mi").innerJoin("shift as s", "s.shift_id", "mi.shift_id")
    .select(["s.org_id", "mi.person_id", sql<string>`count(*)`.as("n")])
    .where("s.shift_date", "=", sql<Date>`${today}::date`).where("mi.rule_id", "=", "short").where("mi.person_id", "is not", null)
    .groupBy(["s.org_id", "mi.person_id"]).execute();

  const out: Partial<Record<OrgId, Record<string, DayCalls>>> = {};
  const of = (org: string, uid: string): DayCalls => ((out[org as OrgId] ??= {})[uid] ??= { calls: 0, transfers: 0, shortCalls: 0, aht: null });
  for (const r of ends) Object.assign(of(r.org_id, r.entity_id), { calls: Number(r.calls), transfers: Number(r.transfers), aht: r.aht === null ? null : Math.round(Number(r.aht)) });
  for (const r of shorts) of(r.org_id, r.person_id!).shortCalls = Number(r.n);
  return out;
}
