import { describe, expect, it } from "vitest";
import type { RosterNames } from "@/lib/store/store";
import { demoSeed } from "./demoSeed";

const withIds: RosterNames = {
  org: [
    { team: "Queue A", tl: "Real Lead One", mgr: "Real Manager", lob: "LOB 1" },
    { team: "Queue B", tl: "Real Lead Two", mgr: "Real Manager", lob: "LOB 2" },
  ],
  agents: [
    { uid: "g-1", name: "Real Agent One", team: "Queue A" },
    { uid: "g-2", name: "Real Agent Two", team: "Queue A" },
    { uid: "g-3", name: "Real Agent Three", team: "Queue B" },
  ],
  members: { "Queue A": ["g-1", "g-2", "g-3"], "Queue B": ["g-3"] },
  people: [
    { uid: "g-1", name: "Real Agent One", supervisor: "g-lead1" },
    { uid: "g-2", name: "Real Agent Two", supervisor: "g-lead1" },
    { uid: "g-3", name: "Real Agent Three", supervisor: "g-lead2" },
    { uid: "g-lead1", name: "Real Lead One", supervisor: "g-mgr" },
    { uid: "g-lead2", name: "Real Lead Two", supervisor: "g-mgr" },
    { uid: "g-mgr", name: "Real Manager", supervisor: null },
  ],
};
// An older save: no IDs, members by name, no leaders.
const byName: RosterNames = {
  org: [{ team: "Queue C", tl: "", mgr: "", lob: "Queue C" }],
  agents: [{ name: "Old Agent One", team: "Queue C" }, { name: "Old Agent Two", team: "Queue C" }],
  members: { "Queue C": ["Old Agent One", "Old Agent Two"] },
};

const realStrings = new Set(["g-1", "g-2", "g-3", "g-lead1", "g-lead2", "g-mgr", "Real Agent One", "Real Agent Two", "Real Agent Three", "Real Lead One", "Real Lead Two", "Real Manager", "Old Agent One", "Old Agent Two"]);

describe("demo floor seed", () => {
  const seed = demoSeed([withIds, byName])!;

  it("keeps no real name or ID anywhere", () => {
    const out = [
      ...seed.seats.flatMap(s => [s.uid!, s.name]),
      ...seed.org.flatMap(t => [t.tl, t.mgr]),
      ...seed.people!.flatMap(p => [p.uid, p.name, p.supervisor ?? ""]),
      ...Object.values(seed.members!).flat(),
    ];
    expect(out.filter(x => realStrings.has(x))).toEqual([]);
    expect(seed.seats.every(s => /^demo:\d+$/.test(s.uid!))).toBe(true);
    expect(seed.real).toBe(false);
  });

  it("keeps the structure: teams, queues and their sizes", () => {
    expect(seed.seats).toHaveLength(5);
    expect(seed.org.map(t => [t.team, t.lob])).toEqual([["Queue A", "LOB 1"], ["Queue B", "LOB 2"], ["Queue C", "Queue C"]]);
    expect(Object.fromEntries(Object.entries(seed.members!).map(([q, ids]) => [q, ids.length]))).toEqual({ "Queue A": 3, "Queue B": 1, "Queue C": 2 });
    expect(seed.seats.map(s => s.team)).toEqual(["Queue A", "Queue A", "Queue B", "Queue C", "Queue C"]);
  });

  it("keeps the reporting lines, under invented leaders", () => {
    const people = new Map(seed.people!.map(p => [p.uid, p]));
    const a1 = people.get(seed.seats[0].uid!)!, a3 = people.get(seed.seats[2].uid!)!;
    const lead1 = people.get(a1.supervisor!)!, lead2 = people.get(a3.supervisor!)!;
    expect(lead1.uid).not.toBe(lead2.uid);
    expect(lead1.supervisor).toBe(lead2.supervisor);
    expect(people.get(lead1.supervisor!)!.supervisor).toBeNull();
    expect(seed.org[0].tl).not.toBe(seed.org[1].tl);
    expect(seed.org[0].mgr).toBe(seed.org[1].mgr);
  });

  it("invents leaders for a roster that names none", () => {
    const only = demoSeed([byName])!;
    expect(only.org[0].tl).not.toBe("");
    expect(only.org[0].mgr).not.toBe("");
    const agent = only.people!.find(p => p.uid === only.seats[0].uid)!;
    expect(agent.supervisor).not.toBeNull();
  });

  it("gives the same names every time, all different", () => {
    expect(demoSeed([withIds, byName])).toEqual(seed);
    const big: RosterNames = { org: [{ team: "Q", tl: "", mgr: "", lob: "Q" }], agents: Array.from({ length: 6000 }, (_, i) => ({ uid: `u${i}`, name: `n${i}`, team: "Q" })) };
    const names = demoSeed([big])!.seats.map(s => s.name);
    expect(new Set(names).size).toBe(6000);
  });

  it("falls back to null when nothing is cached", () => {
    expect(demoSeed([])).toBeNull();
    expect(demoSeed([{ org: [], agents: [] }])).toBeNull();
  });
});
