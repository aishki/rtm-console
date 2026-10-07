import { describe, expect, it } from "vitest";
import type { Roster, Team } from "@/lib/types";
import { SimFeed, seedFromRoster } from "./SimFeed";

const team = (name: string, tl = "", mgr = ""): Team => ({ team: name, tl, mgr, lob: name });
const people = (teamName: string, n: number) => Array.from({ length: n }, (_, i) => ({ name: `${teamName} Agent ${i + 1}`, team: teamName }));

describe("simulator seeded from a real roster", () => {
  it("keeps the simulator's shape under real names: largest teams first, capped at each slot's size", () => {
    const seed = seedFromRoster({
      org: [team("Small"), team("Empty"), team("Big"), team("Mid")],
      agents: [...people("Small", 3), ...people("Big", 60), ...people("Mid", 20)],
    })!;
    expect(seed.real).toBe(true);
    expect(seed.org.map(t => t.team)).toEqual(["Big", "Mid", "Small"]);
    const count = (name: string) => seed.seats.filter(s => s.team === name).length;
    expect([count("Big"), count("Mid"), count("Small")]).toEqual([22, 18, 3]);
    expect(seed.seats[0]).toEqual({ name: "Big Agent 1", team: "Big" });
  });

  it("keeps a real lead and manager, and fills the blanks so every team has both", () => {
    const seed = seedFromRoster({ org: [team("Known", "Real Lead", "Real Manager"), team("Blank")], agents: [...people("Known", 2), ...people("Blank", 1)] })!;
    expect(seed.org[0]).toMatchObject({ tl: "Real Lead", mgr: "Real Manager" });
    expect(seed.org[1].tl).not.toBe("");
    expect(seed.org[1].mgr).not.toBe("");
  });

  it("seats a name once and has nothing to offer without agents", () => {
    const seed = seedFromRoster({ org: [team("A"), team("B")], agents: [{ name: "Same Name", team: "A" }, { name: "Same Name", team: "B" }] })!;
    expect(seed.seats).toEqual([{ name: "Same Name", team: "A" }]);
    expect(seedFromRoster({ org: [team("A")], agents: [] })).toBeNull();
    expect(seedFromRoster(null)).toBeNull();
  });

  it("puts the seeded people on the floor", () => {
    const seed = seedFromRoster({ org: [team("Big")], agents: people("Big", 5) })!;
    let roster: Roster | null = null;
    new SimFeed({ thr: () => 120, strikes: () => 0 }, Math.random, seed).subscribe({ onRoster: r => { roster = r; }, onAgentState() {}, onQueue() {}, onHeartbeat() {} });
    expect(roster!.org.map(t => t.team)).toEqual(["Big"]);
    expect(roster!.agents.map(a => a.name)).toEqual(people("Big", 5).map(p => p.name));
  });
});
