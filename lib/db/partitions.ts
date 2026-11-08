import { type Kysely, sql } from "kysely";
import type { DB } from "./schema";

// notification_log is split by month. Its migration made a partition for each of the next 12
// months and a default one; npm run db:migrate then runs this to keep 12 months ahead. It needs a
// login that can create tables (the migration login): the app's cannot.

/** Months ahead of the current one that should each have their own partition. */
export const MONTHS_AHEAD = 12;

/** The partition name for a month: notification_log_YYYY_MM. */
export const partitionName = (from: Date): string =>
  `notification_log_${from.getUTCFullYear()}_${String(from.getUTCMonth() + 1).padStart(2, "0")}`;

/**
 * Make the partitions missing for this month and the next `ahead`. Bounds are UTC months, as in the
 * migration. Rows already in the default partition for such a month are moved into the new one,
 * since PostgreSQL refuses to add a partition while the default holds its rows. Each month is one
 * transaction. Returns the names made.
 */
export async function ensureNotificationPartitions(db: Kysely<DB>, now = new Date(), ahead = MONTHS_AHEAD): Promise<string[]> {
  const made: string[] = [];
  for (let i = 0; i <= ahead; i++) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i + 1, 1));
    const name = partitionName(from);
    const exists = await sql<{ t: string | null }>`SELECT to_regclass(${name}) AS t`.execute(db);
    if (exists.rows[0]?.t) continue;
    const lo = sql.lit(from.toISOString()), hi = sql.lit(to.toISOString());
    await db.transaction().execute(async tx => {
      // Hold off inserts while rows move, so none lands in the default partition meanwhile.
      await sql`LOCK TABLE notification_log IN SHARE ROW EXCLUSIVE MODE`.execute(tx);
      await sql`CREATE TEMP TABLE notification_log_moving ON COMMIT DROP AS
        SELECT * FROM notification_log_default WHERE notification_ts >= ${lo} AND notification_ts < ${hi}`.execute(tx);
      await sql`DELETE FROM notification_log_default WHERE notification_ts >= ${lo} AND notification_ts < ${hi}`.execute(tx);
      await sql`CREATE TABLE ${sql.id(name)} PARTITION OF notification_log FOR VALUES FROM (${lo}) TO (${hi})`.execute(tx);
      await sql`INSERT INTO notification_log OVERRIDING SYSTEM VALUE SELECT * FROM notification_log_moving`.execute(tx);
    });
    made.push(name);
  }
  return made;
}
