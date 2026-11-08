import { createDb } from "../../lib/db/client";
import { MONTHS_AHEAD, ensureNotificationPartitions } from "../../lib/db/partitions";
import { dbEnv } from "./env";

// Run by npm run db:migrate after the migrations: keeps a notification_log partition for each of
// the next 12 months. Run it again on its own with npm run db:partitions. Safe to repeat.

async function main() {
  const db = createDb(dbEnv());
  try {
    const made = await ensureNotificationPartitions(db);
    console.log(made.length ? `notification_log: added ${made.join(", ")}` : `notification_log: the next ${MONTHS_AHEAD} months already have partitions`);
  } catch (e) {
    console.error("notification_log partitions:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

void main();
