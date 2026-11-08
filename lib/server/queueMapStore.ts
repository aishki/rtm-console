import type { QueueMapRow } from "@/lib/import/queueMap";
import { queueKey } from "@/lib/queueStats";
import { readQueueMapFile } from "@/lib/store/files";
import type { Store } from "@/lib/store/store";
import { bootQueueMap, store } from "./store";

// The WFM queue-to-LOB mapping an admin uploaded. With PostgreSQL it lives in queue_lob_map (and
// the tower, sub_tower and lob tables); without, in .rtm/queue-map.json (gitignored). The rows are
// cached on globalThis so a dev reload keeps them.

interface Cache { rows?: QueueMapRow[]; rev: number }
const g = globalThis as typeof globalThis & { __rtmQueueMap?: Cache };
const cache: Cache = (g.__rtmQueueMap ??= { rev: 1 });

/** One row per queue: where two rows name the same queue, the first wins, as in the upload. */
export function firstPerQueue(rows: QueueMapRow[]): QueueMapRow[] {
  const seen = new Set<string>();
  return rows.filter(r => { const k = queueKey(r.queue); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** The mapping: as the store loaded it at start-up, then as last saved. */
export function loadQueueMap(): QueueMapRow[] {
  return (cache.rows ??= bootQueueMap() ?? readQueueMapFile());
}

/** Save the whole mapping. Resolves once it is kept; throws, keeping the old mapping, when it could not be. */
export async function saveQueueMap(rows: QueueMapRow[], by: string | null = null, s: Store = store()): Promise<void> {
  const one = firstPerQueue(rows);
  await s.saveQueueMap(one, by);
  cache.rows = one;
  cache.rev++;
}

/** Starts at 1 and goes up on every save, so readers can tell when the mapping changed. */
export const queueMapRev = (): number => cache.rev;
