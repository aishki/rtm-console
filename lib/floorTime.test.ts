import { describe, expect, it } from "vitest";
import { floorMidnight, floorSeconds, wallClock } from "./floorTime";

const NY = "America/New_York";

describe("floor time", () => {
  it("reads the Eastern wall clock whatever the server's zone", () => {
    // 2026-10-08 03:30 UTC is 23:30 the day before in New York (EDT, UTC-4) and 11:30 in Manila.
    const at = new Date("2026-10-08T03:30:00Z");
    expect(wallClock(at, NY)).toMatchObject({ year: 2026, month: 10, day: 7, hour: 23, minute: 30 });
    expect(floorSeconds(at, NY)).toBe(23 * 3600 + 30 * 60);
  });

  it("finds Eastern midnight in summer and winter time", () => {
    expect(floorMidnight(new Date("2026-10-08T15:00:00Z"), NY).toISOString()).toBe("2026-10-08T04:00:00.000Z");
    expect(floorMidnight(new Date("2026-12-08T15:00:00Z"), NY).toISOString()).toBe("2026-12-08T05:00:00.000Z");
  });

  it("keeps the day's real midnight on the days the clocks change", () => {
    // 2026-11-01: EDT ends at 02:00. Midnight was still EDT (04:00 UTC), though now is EST.
    expect(floorMidnight(new Date("2026-11-01T18:00:00Z"), NY).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    // 2026-03-08: EDT starts at 02:00. Midnight was EST (05:00 UTC).
    expect(floorMidnight(new Date("2026-03-08T18:00:00Z"), NY).toISOString()).toBe("2026-03-08T05:00:00.000Z");
  });

  it("counts a just-after-midnight moment as the new day", () => {
    expect(floorMidnight(new Date("2026-10-08T04:00:05Z"), NY).toISOString()).toBe("2026-10-08T04:00:00.000Z");
    expect(floorSeconds(new Date("2026-10-08T04:00:05Z"), NY)).toBe(5);
  });
});
