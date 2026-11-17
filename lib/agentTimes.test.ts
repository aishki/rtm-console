import { describe, expect, it } from "vitest";
import type { Agent } from "@/lib/types";
import { mergeAgents, toView, withTimes } from "./agentTimes";

const agent = (more: Partial<Agent> = {}): Agent => ({
  id: 0, uid: "u-0", name: "Amara Reyes", team: "Team Alpha", state: "oncall", stTime: 40, aht: null,
  calls: 3, shortCalls: 0, transfers: 0, onHold: false, holdTime: 0, adh: null, strikes: {}, fired: {}, ...more,
});

describe("agent times on the wire", () => {
  it("sends when the state began, and gives back the same counters at any later second", () => {
    const v = toView(agent({ onHold: true, holdTime: 12 }), 1000);
    expect(v).toMatchObject({ stAt: 960, holdAt: 988 });
    expect(v).not.toHaveProperty("stTime");
    expect(withTimes(v, 1000)).toMatchObject({ stTime: 40, holdTime: 12 });
    expect(withTimes(v, 1030)).toMatchObject({ stTime: 70, holdTime: 42 });
  });

  it("looks the same from one second to the next while nothing changes", () => {
    const a = agent();
    const first = toView(a, 1000);
    a.stTime++;
    expect(toView(a, 1001)).toEqual(first);
  });

  it("sends adherence as a whole percent, so a drift of hundredths changes nothing", () => {
    expect(toView(agent({ adh: 84.97 }), 1000).adh).toBe(84);
    expect(toView(agent({ adh: 84.01 }), 1000)).toEqual(toView(agent({ adh: 84.6 }), 1000));
    expect(toView(agent({ adh: null }), 1000).adh).toBeNull();
  });

  it("ignores the last hold's counter once the agent is off hold", () => {
    const v = toView(agent({ holdTime: 30 }), 1000);
    expect(v.holdAt).toBe(0);
    expect(withTimes(v, 1000).holdTime).toBe(0);
  });
});

describe("mergeAgents", () => {
  const old = [toView(agent(), 1000), toView(agent({ id: 1, uid: "u-1" }), 1000)];

  it("keeps the array when nothing changed", () => {
    expect(mergeAgents(old, undefined)).toBe(old);
    expect(mergeAgents(old, [])).toBe(old);
  });

  it("swaps in a changed agent and keeps the others as the same objects", () => {
    const changed = { ...old[1], state: "acw" as const };
    const next = mergeAgents(old, [changed]);
    expect(next[0]).toBe(old[0]);
    expect(next[1]).toBe(changed);
  });
});
