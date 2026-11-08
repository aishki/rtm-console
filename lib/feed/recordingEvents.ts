import type { OrgId } from "@/lib/orgs";
import type { SourceEvent } from "@/lib/store/store";
import type { FeedSource } from "./FeedSource";

/**
 * Keeps each update the org's feed delivers in source_event_stream, for the day's calls after a
 * restart. Queue numbers and AHT come every few seconds and mostly repeat: only changes are kept.
 */
export function recordingEvents(feed: FeedSource, org: OrgId, save: (events: SourceEvent[]) => void): FeedSource {
  const last = new Map<string, string>();
  /** True when this value differs from the one last kept under `key`. */
  const changed = (key: string, value: string) => { if (last.get(key) === value) return false; last.set(key, value); return true; };
  return {
    kind: feed.kind,
    subscribe: h => feed.subscribe({
      ...h,
      onAgentState(e) {
        const { uid, ...rest } = e;
        save([{ org, at: new Date(), entityType: "agent", entityId: uid, metric: e.callEnded ? "call.end" : "state", value: e.state, payload: rest }]);
        h.onAgentState(e);
      },
      onQueue(q, byQueue) {
        const at = new Date();
        const rows: SourceEvent[] = [];
        const floor = JSON.stringify(q);
        if (changed("floor", floor)) rows.push({ org, at, entityType: "system", entityId: "floor", metric: "queue", value: null, payload: q });
        for (const [name, c] of Object.entries(byQueue ?? {})) {
          if (changed(`queue:${name}`, JSON.stringify(c))) rows.push({ org, at, entityType: "queue", entityId: name, metric: "counts", value: null, payload: c });
        }
        save(rows);
        h.onQueue(q, byQueue);
      },
      onAgentStats(stats) {
        const at = new Date();
        save(stats.flatMap(s => {
          const aht = String(Math.round(s.aht));
          return changed(`aht:${s.uid}`, aht) ? [{ org, at, entityType: "agent" as const, entityId: s.uid, metric: "aht", value: aht }] : [];
        }));
        h.onAgentStats?.(stats);
      },
    }),
  };
}
