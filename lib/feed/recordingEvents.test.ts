import { describe, expect, it } from "vitest";
import type { SourceEvent } from "@/lib/store/store";
import type { QueueCounts } from "@/lib/types";
import type { FeedHandlers, FeedSource } from "./FeedSource";
import { recordingEvents } from "./recordingEvents";

/** A feed the test drives by hand, and what reached the engine and the store. */
function setup() {
  let h!: FeedHandlers;
  const feed: FeedSource = { kind: "gencloud", subscribe: handlers => { h = handlers; return () => {}; } };
  const saved: SourceEvent[] = [];
  const seen: string[] = [];
  recordingEvents(feed, "commercial", e => saved.push(...e)).subscribe({
    onRoster: () => seen.push("roster"),
    onAgentState: e => seen.push(`state:${e.uid}`),
    onQueue: () => seen.push("queue"),
    onAgentStats: () => seen.push("stats"),
    onHeartbeat: () => seen.push("beat"),
  });
  return { h: () => h, saved, seen };
}

const QUEUE = { cq: 3, sl: 90, asa: 10, ab: 1 };
const COUNTS: QueueCounts = { waiting: 3, offered: 41, answered: 40, abandoned: 1, answerSec: 400, slWithin: 36, slCounted: 40 };

describe("keeping a Genesys floor's updates", () => {
  it("keeps each agent update, a call end as call.end, and still hands everything on", () => {
    const { h, saved, seen } = setup();
    h().onAgentState({ uid: "u-1", state: "acw" });
    h().onAgentState({ uid: "u-1", state: "acw", callEnded: { transferred: true, durationSec: 212 } });
    h().onHeartbeat();
    expect(saved.map(e => [e.org, e.entityType, e.entityId, e.metric, e.value])).toEqual([
      ["commercial", "agent", "u-1", "state", "acw"],
      ["commercial", "agent", "u-1", "call.end", "acw"],
    ]);
    expect(saved[1].payload).toEqual({ state: "acw", callEnded: { transferred: true, durationSec: 212 } });
    expect(seen).toEqual(["state:u-1", "state:u-1", "beat"]);
  });

  it("keeps queue numbers and AHT only when they change", () => {
    const { h, saved, seen } = setup();
    h().onQueue(QUEUE, { Billing: COUNTS });
    h().onQueue(QUEUE, { Billing: COUNTS });
    h().onQueue({ ...QUEUE, cq: 4 }, { Billing: COUNTS });
    h().onAgentStats!([{ uid: "u-1", aht: 300.4 }]);
    h().onAgentStats!([{ uid: "u-1", aht: 300.2 }]);
    h().onAgentStats!([{ uid: "u-1", aht: 310 }]);
    expect(saved.map(e => [e.entityType, e.entityId, e.metric, e.value])).toEqual([
      ["system", "floor", "queue", null], ["queue", "Billing", "counts", null],
      ["system", "floor", "queue", null],
      ["agent", "u-1", "aht", "300"], ["agent", "u-1", "aht", "310"],
    ]);
    expect(seen.filter(s => s === "queue" || s === "stats")).toHaveLength(6);
  });
});
