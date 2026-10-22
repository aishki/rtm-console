import { describe, it, expect } from "vitest";
import { rollUp, queueKey } from "./queueStats";
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
});
