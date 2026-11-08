import { describe, expect, it } from "vitest";
import type { QueueMapRow } from "@/lib/import/queueMap";
import type { AgentState, AgentStateEvent, QueueCounts, RosterAgent, Rule, Team } from "@/lib/types";
import { createEngine } from "./engine";
import { defaultRules, isBreach, myTargets } from "./rules";
import { patchOverride, placeAgents, placesIn, ruleFor } from "./overrides";
import { severalLobs } from "./scope";

const acw = (): Rule => defaultRules().find(r => r.id === "acw")!;
const LOCAL = { tower: "Provider", subTower: "Claims", lob: "Local" };
const HOST = { tower: "Provider", subTower: "Claims", lob: "Host" };

describe("which setting applies", () => {
  it("takes the most specific setting, field by field", () => {
    const r = acw();
    r.overrides = [
      { tower: "Provider", subTower: "", lob: "", thr: 180 },
      { ...LOCAL, sev: "crit" },
    ];
    expect(ruleFor(r, LOCAL)).toMatchObject({ thr: 180, sev: "crit", route: "nudge", on: true });
    expect(ruleFor(r, HOST)).toMatchObject({ thr: 180, sev: "warn" });
    expect(ruleFor(r, { tower: "Member", subTower: "GB", lob: "Horizon" })).toBe(r);
    expect(ruleFor(r, undefined)).toBe(r);
  });

  it("lets a LOB override its Sub-Tower and Tower", () => {
    const r = acw();
    r.overrides = [
      { ...LOCAL, thr: 300 },
      { tower: "Provider", subTower: "", lob: "", thr: 180 },
      { tower: "Provider", subTower: "Claims", lob: "", thr: 240, on: false },
    ];
    expect(ruleFor(r, LOCAL)).toMatchObject({ thr: 300, on: false });
    expect(ruleFor(r, HOST)).toMatchObject({ thr: 240, on: false });
  });

  it("does not reach a Sub-Tower of the same name in another Tower", () => {
    const r = acw();
    r.overrides = [{ tower: "Provider", subTower: "Claims", lob: "", thr: 240 }];
    expect(ruleFor(r, { tower: "Member", subTower: "Claims", lob: "Local" }).thr).toBe(120);
  });
});

describe("changing an override", () => {
  it("sets, takes back to the level above, and removes", () => {
    const r = acw();
    expect(patchOverride(r, LOCAL, { thr: 200, sev: "crit" })).toEqual({ ...LOCAL, thr: 200, sev: "crit" });
    expect(patchOverride(r, LOCAL, { sev: null })).toEqual({ ...LOCAL, thr: 200 });
    expect(r.overrides).toHaveLength(1);
    expect(patchOverride(r, LOCAL, { thr: null })).toBeNull();
    expect(r.overrides).toBeUndefined();
  });

  it("refuses an override for a system rule", () => {
    const e = createEngine();
    expect(() => e.setOverride("gnr", LOCAL, { thr: 60 })).toThrow(/system rule/);
  });
});

const MAP: QueueMapRow[] = [
  { tower: "Provider", subTower: "Claims", lob: "Local", queue: "Q_LOCAL_1" },
  { tower: "Provider", subTower: "Claims", lob: "Local", queue: "Q_LOCAL_2" },
  { tower: "Provider", subTower: "Claims", lob: "Host", queue: "Q_HOST" },
  { tower: "Member", subTower: "GB", lob: "Horizon", queue: "Q_HORIZON" },
];

describe("placing agents", () => {
  it("lists every Tower, Sub-Tower and LOB in the mapping", () => {
    expect(placesIn(MAP)).toEqual([
      { tower: "Provider", subTower: "", lob: "" }, { tower: "Provider", subTower: "Claims", lob: "" }, LOCAL, HOST,
      { tower: "Member", subTower: "", lob: "" }, { tower: "Member", subTower: "GB", lob: "" }, { tower: "Member", subTower: "GB", lob: "Horizon" },
    ]);
  });

  it("gives each agent the LOB with most of their queues, ties by LOB name, and flags agents in several", () => {
    const { places, severalLobs } = placeAgents(MAP, {
      Q_LOCAL_1: [0, 1], q_local_2: [0], Q_HOST: [0, 2], Q_HORIZON: [2], Q_UNMAPPED: [3],
    });
    expect(places.get(0)).toEqual(LOCAL); // two Local queues, one Host
    expect(places.get(1)).toEqual(LOCAL);
    expect(places.get(2)).toEqual({ tower: "Member", subTower: "GB", lob: "Horizon" }); // one each: Horizon before Host
    expect(places.has(3)).toBe(false);
    expect(severalLobs.map(s => s.id).sort()).toEqual([0, 2]);
    expect(severalLobs.find(s => s.id === 0)!.lobs).toEqual([LOCAL, HOST]);
  });
});

const ORG: Team[] = ["Q_LOCAL_1", "Q_HOST", "Q_HORIZON"].map(team => ({ team, tl: "", mgr: "", lob: team }));
const ROSTER: RosterAgent[] = [
  { uid: "u-local", name: "Local Agent", team: "Q_LOCAL_1", state: "avail" },
  { uid: "u-host", name: "Host Agent", team: "Q_HOST", state: "avail" },
  { uid: "u-both", name: "Both Agent", team: "Q_HORIZON", state: "avail" },
];
const counts = (waiting: number): QueueCounts => ({ waiting, offered: 10, answered: 10, abandoned: 0, answerSec: 100, slWithin: 10, slCounted: 10 });

function floor() {
  const mapping = { rev: 1, rows: MAP };
  const e = createEngine({}, { rules: defaultRules(), year: () => 2026, mapping: () => mapping });
  e.reset({ t: 8 * 3600 });
  e.ingest.onRoster({ org: ORG, agents: ROSTER, members: { Q_LOCAL_1: ["u-local", "u-both"], Q_HOST: ["u-host"], Q_HORIZON: ["u-both"] } });
  const run = (seconds: number) => { for (let i = 0; i < seconds; i++) { e.ingest.onHeartbeat(); e.tick(); } };
  const set = (uid: string, state: AgentState, extra: Partial<AgentStateEvent> = {}) => e.ingest.onAgentState({ uid, state, ...extra });
  const agent = (uid: string) => e.S.agents.find(a => a.uid === uid)!;
  return { e, run, set, agent, mapping };
}

describe("the engine with overrides", () => {
  it("places agents from the mapping and the roster's membership", () => {
    const { e, run, agent } = floor();
    run(1);
    expect(agent("u-local").place).toEqual(LOCAL);
    expect(agent("u-host").place).toEqual(HOST);
    // One Local queue and one Horizon queue: Horizon comes before Local.
    expect(agent("u-both").place).toEqual({ tower: "Member", subTower: "GB", lob: "Horizon" });
    expect(severalLobs(e.S).map(s => s.name)).toEqual(["Both Agent"]);
  });

  it("checks each agent against their LOB's settings", () => {
    const { e, run, set, agent } = floor();
    e.setOverride("acw", LOCAL, { thr: 300, sev: "crit" });
    set("u-local", "acw"); set("u-host", "acw");
    run(150);
    expect(e.S.ledger.map(r => r.agentId)).toEqual(["u-host"]);
    expect(e.S.ledger[0]).toMatchObject({ cond: "State ACW longer than 120s", place: HOST });
    expect(isBreach(agent("u-local"), e.S.rules)).toBe(false);
    run(160);
    const local = e.S.ledger.find(r => r.agentId === "u-local")!;
    expect(local).toMatchObject({ cond: "State ACW longer than 300s", sev: "crit", place: LOCAL });
    expect(myTargets(agent("u-local"), e.S.rules).find(t => t.id === "acw")!.cond).toBe("State ACW longer than 300s");
  });

  it("turns a rule off for one LOB only", () => {
    const { e, run, set } = floor();
    e.setOverride("acw", { tower: "Provider", subTower: "Claims", lob: "" }, { on: false });
    set("u-local", "acw"); set("u-host", "acw"); set("u-both", "acw");
    run(130);
    expect(e.S.ledger.map(r => r.agentId)).toEqual(["u-both"]);
  });

  it("places agents again when the mapping changes", () => {
    const { run, agent, mapping } = floor();
    run(1);
    mapping.rows = [{ tower: "Member", subTower: "GB", lob: "Horizon", queue: "Q_HOST" }];
    mapping.rev = 2;
    run(1);
    expect(agent("u-host").place).toEqual({ tower: "Member", subTower: "GB", lob: "Horizon" });
    expect(agent("u-local").place).toBeUndefined();
  });

  it("checks a queue rule against the numbers of a group with an override, once per breach", () => {
    const { e, run } = floor();
    e.setOverride("cq", { tower: "Provider", subTower: "Claims", lob: "" }, { thr: 4 });
    const send = (local: number, host: number, horizon: number) => {
      e.ingest.onQueue({ cq: local + host + horizon, sl: 100, asa: 10, ab: 0 }, { Q_LOCAL_1: counts(local), Q_HOST: counts(host), Q_HORIZON: counts(horizon) });
      run(1);
    };
    send(2, 2, 3); // Claims has 4 waiting: not above 4; the floor's 7 is not above 8
    expect(e.S.ledger).toHaveLength(0);
    send(3, 2, 0); // Claims 5 waiting
    expect(e.S.ledger).toHaveLength(1);
    expect(e.S.ledger[0]).toMatchObject({ ruleId: "cq", isFloor: true, team: "Provider › Claims", val: "5 calls waiting", cond: "Calls in queue above 4calls", place: { tower: "Provider", subTower: "Claims", lob: "" } });
    send(3, 3, 0);
    expect(e.S.ledger).toHaveLength(1);
    send(1, 1, 0); // recovered: re-armed
    send(5, 0, 0);
    expect(e.S.ledger).toHaveLength(2);
  });
});
