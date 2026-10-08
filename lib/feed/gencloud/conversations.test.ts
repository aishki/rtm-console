import { describe, expect, it } from "vitest";
import { CallTracker } from "./conversations";

const T0 = Date.parse("2026-10-08T14:00:00Z");
const iso = (s: number) => new Date(T0 + s * 1000).toISOString();

/** A conversation event with one customer and one agent call, shaped as the queue topic sends it. */
function conv(call: Record<string, unknown>, id = "c1", userId = "u1") {
  return {
    id,
    participants: [
      { id: "p-cust", purpose: "customer", calls: [{ state: "connected" }] },
      { id: "p-agent", purpose: "agent", userId, calls: [{ connectedTime: iso(0), ...call }] },
    ],
  };
}

describe("CallTracker", () => {
  it("reports a call end with its length and whether it was a transfer", () => {
    const t = new CallTracker();
    t.update(conv({ state: "connected" }), T0);
    const [end] = t.update(conv({ state: "disconnected", disconnectType: "peer", disconnectedTime: iso(95) }), T0 + 95_000);
    expect(end).toMatchObject({ userId: "u1", ended: { transferred: false, durationSec: 95 }, onCall: false });
    const t2 = new CallTracker();
    t2.update(conv({ state: "connected" }), T0);
    expect(t2.update(conv({ state: "disconnected", disconnectType: "transfer", disconnectedTime: iso(40) }))[0].ended).toEqual({ transferred: true, durationSec: 40 });
  });

  it("does not count a call it never saw connected", () => {
    const t = new CallTracker();
    const [c] = t.update(conv({ state: "disconnected", disconnectType: "peer", disconnectedTime: iso(30) }));
    expect(c.ended).toBeUndefined();
    expect(t.update(conv({ state: "terminated" }))[0]?.ended).toBeUndefined();
    // A call first seen already terminated is ignored altogether.
    expect(new CallTracker().update(conv({ state: "terminated" }))).toEqual([]);
  });

  it("reports hold start with its time, and hold end", () => {
    const t = new CallTracker();
    t.update(conv({ state: "connected" }), T0);
    expect(t.update(conv({ state: "connected", held: true, startHoldTime: iso(20) }))[0].hold).toEqual({ on: true, since: T0 + 20_000 });
    expect(t.update(conv({ state: "connected", held: false }))[0].hold).toEqual({ on: false, since: undefined });
  });

  it("ends the hold when a held call disconnects", () => {
    const t = new CallTracker();
    t.update(conv({ state: "connected", held: true, startHoldTime: iso(5) }), T0);
    expect(t.update(conv({ state: "disconnected", held: true, disconnectType: "client", disconnectedTime: iso(60) }))[0].hold?.on).toBe(false);
  });

  it("tracks after-call work from pending to complete", () => {
    const t = new CallTracker();
    t.update(conv({ state: "connected" }), T0);
    const [d] = t.update(conv({ state: "disconnected", disconnectType: "peer", disconnectedTime: iso(100), afterCallWork: { state: "pending", startTime: iso(100) } }));
    expect(d).toMatchObject({ onCall: false, acwSince: T0 + 100_000 });
    const [done] = t.update(conv({ state: "terminated", afterCallWork: { state: "complete", startTime: iso(100), endTime: iso(160) } }));
    expect(done).toMatchObject({ acwSince: null, onCall: false });
    expect(t.summary("u1")).toEqual({ onCall: false, acwSince: null });
  });

  it("ignores the same event again, as a second watched queue sends it", () => {
    const t = new CallTracker();
    t.update(conv({ state: "connected" }), T0);
    const end = conv({ state: "disconnected", disconnectType: "peer", disconnectedTime: iso(50) });
    expect(t.update(end)).toHaveLength(1);
    expect(t.update(end)).toEqual([]);
  });

  it("marks a call seen for the first time, and keeps agents' calls apart", () => {
    const t = new CallTracker();
    expect(t.update(conv({ state: "connected" }, "c1", "u1"))[0].first).toBe(true);
    t.update(conv({ state: "connected" }, "c2", "u2"));
    expect(t.update(conv({ state: "connected", held: true }, "c1", "u1"))[0].first).toBe(false);
    expect(t.summary("u2")).toEqual({ onCall: true, acwSince: null });
  });
});
