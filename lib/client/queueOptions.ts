import type { MultiOption } from "@/components/ui/MultiSelect";
import type { QueueMapRow } from "@/lib/import/queueMap";
import { queueKey } from "@/lib/queueStats";
import { UNMAPPED } from "@/lib/queueTree";

/**
 * Queue filter options for a list of rows: each queue the rows name, with how many rows it has,
 * grouped under "Tower · LOB" from the queue mapping (unmapped queues last).
 */
export function queueFilterOptions(queues: string[], map: QueueMapRow[]): MultiOption[] {
  const counts = new Map<string, number>();
  for (const q of queues) if (q) counts.set(q, (counts.get(q) ?? 0) + 1);
  const lobOf = new Map<string, string>();
  for (const r of map) if (!lobOf.has(queueKey(r.queue))) lobOf.set(queueKey(r.queue), `${r.tower} · ${r.lob || r.subTower || r.tower}`);
  return [...counts]
    .map(([q, n]) => ({ value: q, label: `${q} (${n})`, group: lobOf.get(queueKey(q)) ?? UNMAPPED }))
    .sort((a, b) => (a.group === UNMAPPED) !== (b.group === UNMAPPED) ? (a.group === UNMAPPED ? 1 : -1) : a.group.localeCompare(b.group) || a.value.localeCompare(b.value));
}
