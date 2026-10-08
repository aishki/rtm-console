import { describe, it, expect } from "vitest";
import { parseObservations, parseAggregates } from "./client";

describe("parseObservations", () => {
  it("maps observation metrics and service level ratio", () => {
    const [o] = parseObservations({ results: [{ group:{ queueId:"q1" }, data:[
      { metric:"oWaiting", stats:{ count:3 } },
      { metric:"oInteracting", stats:{ count:2 } },
      { metric:"oUserRoutingStatuses", qualifier:"OFF_QUEUE", stats:{ count:5 } },
      { metric:"oServiceLevel", stats:{ ratio:0.9 } } ]}] });
    expect(o).toMatchObject({ queueId:"q1", waiting:3, interacting:2, offQueueUsers:5 });
    expect(o.serviceLevelPct).toBeCloseTo(90);
  });
  it("returns [] for empty results (no crash)", () => {
    expect(parseObservations({ results: [] })).toEqual([]);
    expect(parseObservations({})).toEqual([]);
  });
});

describe("parseAggregates", () => {
  it("maps aggregate metrics, converting ms to seconds", () => {
    const [a] = parseAggregates({ results: [{ group:{ queueId:"q1" }, data:[{ metrics:[
      { metric:"nOffered", stats:{ count:10 } },
      { metric:"tAbandon", stats:{ count:1 } },
      { metric:"tAnswered", stats:{ count:9, avg:20000 } },
      { metric:"tHandle", stats:{ avg:300000 } } ]}] }] });
    expect(a).toMatchObject({ queueId:"q1", offered:10, abandoned:1, answered:9 });
    expect(a.asaSec).toBeCloseTo(20);      // tAnswered.avg 20000ms -> 20s (ASA ruling)
    expect(a.avgHandleSec).toBeCloseTo(300);
  });
  it("derives averages from sum and count, and reads the interval service level", () => {
    const [a] = parseAggregates({ results: [{ group:{ queueId:"q1" }, data:[{ metrics:[
      { metric:"tAnswered", stats:{ count:4, sum:80000 } },
      { metric:"tHandle", stats:{ count:4, sum:1200000 } },
      { metric:"oServiceLevel", stats:{ ratio:0.75, numerator:3, denominator:4, target:0.8 } } ]}] }] });
    expect(a.asaSec).toBeCloseTo(20);
    expect(a.avgHandleSec).toBeCloseTo(300);
    expect(a.answerSec).toBeCloseTo(80);
    expect(a).toMatchObject({ slWithin:3, slCounted:4 });
  });
  it("tolerates missing metrics", () => {
    const [a] = parseAggregates({ results: [{ group:{ queueId:"q1" }, data:[{ metrics:[] }] }] });
    expect(a).toMatchObject({ queueId:"q1", offered:0, abandoned:0 });
    expect(a.asaSec).toBeNull();
  });
});
