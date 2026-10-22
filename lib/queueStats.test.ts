import { describe, it, expect } from "vitest";
import { defaultRules, thrOf } from "./engine/rules";
import { rollUp, queueKey, queueLevels } from "./queueStats";
import type { QueueCounts } from "./types";

const c = (p: Partial<QueueCounts>): QueueCounts => ({ waiting: 0, offered: 0, answered: 0, abandoned: 0, answerSec: 0, slWithin: 0, slCounted: 0, ...p });

describe("queueStats", () => {
  it("weights by calls, not by queue", () => {
    const q = rollUp([c({ waiting: 2, offered: 700, answered: 690, abandoned: 10, answerSec: 690 * 20, slWithin: 630, slCounted: 700 }),
                      c({ waiting: 5, offered: 10, answered: 5, abandoned: 5, answerSec: 5 * 100, slWithin: 1, slCounted: 10 })])!;
    expect(q.cq).toBe(7);
    expect(q.sl).toBeCloseTo((631 / 710) * 100);
    expect(q.asa).toBeCloseTo((690 * 20 + 500) / 695);
    expect(q.ab).toBeCloseTo((15 / 710) * 100);
  });
  it("has no service level before any call is counted", () => expect(rollUp([c({ waiting: 3 })])!.sl).toBeNull());
  it("is null with no queues reporting", () => expect(rollUp([])).toBeNull());
  it("keys queue names ignoring case and surrounding spaces", () => expect(queueKey("  csbd_x ")).toBe(queueKey("CSBD_X")));
  it("colours call numbers with the KPI tile thresholds", () => {
    const rules = defaultRules(), thr = (id: Parameters<typeof thrOf>[1]) => thrOf(rules, id);
    expect(queueLevels({ cq: thr("cq") + 1, sl: thr("sl") - 1, asa: 46, ab: thr("aband") + 1 }, rules)).toEqual({ cq: "crit", sl: "crit", asa: "warn", ab: "crit" });
    expect(queueLevels({ cq: thr("cq") - 1, sl: thr("sl") + 1, asa: 10, ab: thr("aband") - 1 }, rules)).toEqual({ cq: "warn", sl: "warn", asa: "ok", ab: "warn" });
    expect(queueLevels({ cq: 0, sl: null, asa: 0, ab: 0 }, rules)).toEqual({ cq: "ok", sl: "ok", asa: "ok", ab: "ok" });
  });
});
