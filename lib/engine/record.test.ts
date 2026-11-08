import { describe, expect, it } from "vitest";
import type { AgentState, Incident, Instance, InvAction, RosterAgent, Team, View } from "@/lib/types";
import { teamLines } from "@/lib/feed/teamLines";
import { createEngine } from "./engine";
import { type AckVia, type Recorder, type SavedFloor, firedKeys, readFiredKeys } from "./record";

const ORG: Team[] = [{ team: "Team Alpha", tl: "Rina Velasco", mgr: "Ava Santiago", lob: "PAP Intake" }];
const ROSTER: RosterAgent[] = [
  { uid: "u-amara", name: "Amara Reyes", team: "Team Alpha", state: "avail" },
  { uid: "u-joshua", name: "Joshua Lim", team: "Team Alpha", state: "avail" },
];
const QUEUE_OK = { cq: 0, sl: 90, asa: 10, ab: 1 };
const QUEUE_BUSY = { cq: 99, sl: 90, asa: 10, ab: 1 };

/** A recorder that keeps what it was told, as the store would get it. */
function recorder() {
  const log = {
    fired: [] as { rec: Instance; thr: number; incident: Incident | null }[],
    acked: [] as { ns: number[]; by: View | null; via: AckVia }[],
    commented: [] as number[],
    moved: [] as { inc: string; action: InvAction; status: string; by: View | null }[],
    floor: [] as string[][],
  };
  const r: Recorder = {
    fired: (rec, x) => log.fired.push({ rec: { ...rec }, thr: x.thr, incident: x.incident && { ...x.incident } }),
    acked: (recs, by, via) => log.acked.push({ ns: recs.map(x => x.n), by, via }),
    commented: rec => log.commented.push(rec.n),
    incidentMoved: (i, action, by) => log.moved.push({ inc: i.inc, action, status: i.status, by }),
    floorFired: keys => log.floor.push(keys),
  };
  return { r, log };
}

function setup(opts: { ids?: { n: number }; saved?: SavedFloor; today?: string } = {}) {
  const { r, log } = recorder();
  const e = createEngine({}, { year: () => 2026, record: r, ids: opts.ids });
  e.reset({ t: 8 * 3600 });
  if (opts.saved) e.restore(opts.saved, opts.today ?? opts.saved.date);
  e.ingest.onRoster({ org: ORG, agents: ROSTER, people: teamLines(ORG, ROSTER, "") });
  const run = (seconds: number) => { for (let i = 0; i < seconds; i++) { e.ingest.onHeartbeat(); e.tick(); } };
  const set = (uid: string, state: AgentState) => e.ingest.onAgentState({ uid, state });
  const episode = (uid: string, state: AgentState, seconds: number) => { set(uid, state); run(seconds + 1); set(uid, "avail"); run(1); };
  return { e, log, run, episode };
}

describe("what the engine tells its recorder", () => {
  it("tells of each call-out, with the threshold and the incident it opened", () => {
    const { log, episode } = setup();
    for (let i = 0; i < 3; i++) episode("u-amara", "acw", 120);
    expect(log.fired.map(f => [f.rec.strikes, f.rec.stage, f.thr, f.incident?.inc ?? null])).toEqual([
      [1, "nudge", 120, null], [2, "lead", 120, null], [3, "ops", 120, "INC-2026-0001"],
    ]);
    expect(log.fired[2].incident).toMatchObject({ agentId: "u-amara", instances: 3, status: "Open" });
  });

  it("numbers call-outs from a counter shared with other floors", () => {
    const ids = { n: 41 };
    const a = setup({ ids }), b = setup({ ids });
    a.episode("u-amara", "acw", 120);
    b.episode("u-joshua", "acw", 120);
    a.episode("u-amara", "acw", 120);
    expect([...a.log.fired, ...b.log.fired].map(f => f.rec.n).sort()).toEqual([42, 43, 44]);
    expect(ids.n).toBe(44);
  });

  it("tells who acknowledged, how, and of reasons and investigation moves that changed something", () => {
    const { e, log, episode } = setup();
    for (let i = 0; i < 3; i++) episode("u-amara", "acw", 120);
    const [third, second, first] = e.S.ledger;
    const lead: View = { role: "tl", who: "u-rina" }, mgr: View = { role: "mgr", who: "u-ava" }, admin: View = { role: "admin", who: null };
    e.ack(first.n, lead, "push");
    e.ack(first.n, lead); // already acknowledged: nothing new
    e.comment(second.n, "System was slow", true);
    expect(e.ackAll(admin)).toBe(1);
    expect(log.acked).toEqual([
      { ns: [first.n], by: lead, via: "push" },
      { ns: [second.n], by: { role: "agent", who: "u-amara" }, via: "console" },
      { ns: [third.n], by: admin, via: "ack_all" },
    ]);
    expect(log.commented).toEqual([second.n]);

    e.invAction("INC-2026-0001", "start", undefined, mgr);
    e.invAction("INC-2026-0001", "close", undefined, mgr); // no disposition yet: refused
    e.invAction("INC-2026-0001", "record", "Coached", mgr);
    e.invAction("INC-2026-0001", "close", undefined, mgr);
    expect(log.moved).toEqual([
      { inc: "INC-2026-0001", action: "start", status: "Investigating", by: mgr },
      { inc: "INC-2026-0001", action: "record", status: "Investigating", by: mgr },
      { inc: "INC-2026-0001", action: "close", status: "Closed", by: mgr },
    ]);
  });

  it("tells when the queue rules in breach change, and only then", () => {
    const { e, log, run } = setup();
    e.ingest.onQueue(QUEUE_BUSY);
    run(3);
    e.ingest.onQueue(QUEUE_OK);
    run(2);
    expect(log.floor).toEqual([["cq"], []]);
  });
});

describe("saving which rules are in breach", () => {
  it("writes the floor's and each group's as text, and reads them back", () => {
    const keys = firedKeys({ cq: true, sl: false, gnr: true }, { "aband|Provider\u0000Claims\u0000Local": true, "cq|Provider\u0000\u0000": false });
    expect(keys).toEqual(["aband@[\"Provider\",\"Claims\",\"Local\"]", "cq", "gnr"]);
    expect(keys.some(k => k.includes("\u0000"))).toBe(false);
    expect(readFiredKeys(keys)).toEqual({ floor: ["cq", "gnr"], groups: [{ id: "aband", place: { tower: "Provider", subTower: "Claims", lob: "Local" } }] });
  });
});

describe("carrying on after a restart", () => {
  const callout = (n: number, over: Partial<Instance> = {}): Instance => ({
    n, t: 9 * 3600, agent: "Amara Reyes", agentId: "u-amara", isFloor: false, team: "Team Alpha", rule: "Extended ACW", ruleId: "acw",
    val: "2:01", stage: "lead", sev: "warn", status: "open", ackT: null, strikes: 2, inc: "", cmt: null, cond: "State ACW longer than 120s", rev: 0, ...over,
  });
  const SAVED: SavedFloor = {
    date: "2026-11-09",
    ledger: [callout(12), callout(11, { strikes: 1, stage: "nudge", status: "acked", ackT: 9 * 3600 + 30 })],
    incidents: [{ inc: "INC-2026-0007", t: 8 * 3600, agent: "Joshua Lim", agentId: "u-joshua", team: "Team Alpha", rule: "Extended ACW", ruleId: "acw", instances: 3, status: "Investigating", disposition: "", closedT: null }],
    strikes: { "u-amara": { acw: 2 } },
    floorFired: ["cq"],
  };

  it("brings back the call-outs, incidents and today's strikes, and the next strike follows on", () => {
    const { e, log, episode } = setup({ saved: SAVED });
    expect(e.S.ledger.map(r => r.n)).toEqual([12, 11]);
    expect(e.S.incidents.map(i => i.inc)).toEqual(["INC-2026-0007"]);
    expect(e.S.agents.find(a => a.uid === "u-amara")!.strikes).toEqual({ acw: 2 });
    episode("u-amara", "acw", 120);
    expect(log.fired[0].rec).toMatchObject({ n: 13, strikes: 3, stage: "ops" });
  });

  it("brings back today's calls, transfers, short calls and AHT as the roster brings each agent", () => {
    const calls = { "u-amara": { calls: 14, transfers: 2, shortCalls: 1, aht: 380 }, "u-joshua": { calls: 3, transfers: 0, shortCalls: 0, aht: null } };
    const { e, episode } = setup({ saved: { ...SAVED, calls } });
    expect(e.S.agents.find(a => a.uid === "u-amara")).toMatchObject({ calls: 14, transfers: 2, shortCalls: 1, aht: 380 });
    expect(e.S.agents.find(a => a.uid === "u-joshua")).toMatchObject({ calls: 3, aht: 420 });
    // The next call counts on from there.
    e.ingest.onAgentState({ uid: "u-amara", state: "avail", callEnded: { durationSec: 300 } });
    episode("u-joshua", "avail", 0);
    expect(e.S.agents.find(a => a.uid === "u-amara")!.calls).toBe(15);
  });

  it("leaves yesterday's calls behind", () => {
    const { e } = setup({ saved: { ...SAVED, calls: { "u-amara": { calls: 14, transfers: 2, shortCalls: 1, aht: 380 } } }, today: "2026-11-10" });
    expect(e.S.agents.find(a => a.uid === "u-amara")).toMatchObject({ calls: 0, transfers: 0, shortCalls: 0 });
  });

  it("does not raise a queue call-out again for a breach that was already running", () => {
    const { e, log, run } = setup({ saved: SAVED });
    e.ingest.onQueue(QUEUE_BUSY);
    run(3);
    expect(log.fired).toEqual([]);
    expect(log.floor).toEqual([]);
  });

  it("starts strikes and breaches again from zero when the saved floor is from an earlier day", () => {
    const { e, log, run } = setup({ saved: SAVED, today: "2026-11-10" });
    expect(e.S.ledger).toHaveLength(2);
    expect(e.S.agents.find(a => a.uid === "u-amara")!.strikes).toEqual({});
    e.ingest.onQueue(QUEUE_BUSY);
    run(2);
    expect(log.fired.map(f => f.rec.ruleId)).toEqual(["cq"]);
  });
});
