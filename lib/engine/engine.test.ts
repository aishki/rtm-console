import { describe, expect, it } from "vitest";
import type { AgentState, AgentStateEvent, NudgeEvent, RosterAgent, RuleId, Team, ToastEvent, View } from "@/lib/types";
import { createEngine } from "./engine";
import { stageFor } from "./escalation";
import { isBreach, myTargets } from "./rules";
import { PERMS, canAck, canComment, inScope, resolveView, scopeAgents, scopeIncidents, scopeLedger, scopeTeams } from "./scope";

const ORG: Team[] = [
  { team: "Team Alpha", tl: "Rina Velasco", mgr: "Ava Santiago", lob: "PAP Intake" },
  { team: "Team Bravo", tl: "Marco Tan", mgr: "Ava Santiago", lob: "PAP Intake" },
  { team: "Team Delta", tl: "Jon Rivera", mgr: "Leo Fernandez", lob: "Member Care" },
];
const ROSTER: RosterAgent[] = [
  { name: "Amara Reyes", team: "Team Alpha", state: "avail" },
  { name: "Joshua Lim", team: "Team Alpha", state: "avail" },
  { name: "Bea Santos", team: "Team Bravo", state: "avail" },
  { name: "Miguel Cruz", team: "Team Delta", state: "avail" },
];

function setup() {
  const toasts: ToastEvent[] = [], nudges: NudgeEvent[] = [];
  const e = createEngine({ toast: t => toasts.push(t), nudge: n => nudges.push(n) });
  e.reset({ t: 8 * 3600 });
  e.ingest.onRoster({ org: ORG, agents: ROSTER });
  const run = (seconds: number) => { for (let i = 0; i < seconds; i++) { e.ingest.onHeartbeat(); e.tick(); } };
  const set = (agent: string, state: AgentState, extra: Partial<AgentStateEvent> = {}) => e.ingest.onAgentState({ agent, state, ...extra });
  const agent = (name: string) => e.S.agents.find(a => a.name === name)!;
  /** One full episode of a duration rule: sit in `state` just past `seconds`, then go back to Available. */
  const episode = (name: string, state: AgentState, seconds: number) => { set(name, state); run(seconds + 1); set(name, "avail"); run(1); };
  const of = (name: string, ruleId?: RuleId) => e.S.ledger.filter(r => r.agent === name && (!ruleId || r.ruleId === ruleId));
  return { e, toasts, nudges, run, set, agent, episode, of };
}

describe("strike counting", () => {
  it("counts per agent, per rule", () => {
    const { e, episode, agent } = setup();
    episode("Amara Reyes", "acw", 120);
    episode("Amara Reyes", "acw", 120);
    episode("Amara Reyes", "auxp", 300);
    episode("Joshua Lim", "acw", 120);
    expect(agent("Amara Reyes").strikes).toEqual({ acw: 2, auxp: 1 });
    expect(agent("Joshua Lim").strikes).toEqual({ acw: 1 });
    expect(agent("Bea Santos").strikes).toEqual({});
    expect(e.S.ledger).toHaveLength(4);
  });

  it("records the strike number and value on each instance, newest first", () => {
    const { episode, of } = setup();
    episode("Amara Reyes", "acw", 120);
    episode("Amara Reyes", "acw", 120);
    const rows = of("Amara Reyes", "acw");
    expect(rows.map(r => r.strikes)).toEqual([2, 1]);
    expect(rows[0]).toMatchObject({ val: "2:00", cond: "State ACW longer than 120s", status: "open", isFloor: false, team: "Team Alpha" });
    expect(rows[0].n).toBeGreaterThan(rows[1].n);
  });

  it("fires the short-call event rule once per released call under the threshold", () => {
    const { set, run, agent, of } = setup();
    for (let i = 0; i < 2; i++) { set("Amara Reyes", "oncall"); run(10); set("Amara Reyes", "acw", { callEnded: {} }); run(1); set("Amara Reyes", "avail"); run(1); }
    set("Amara Reyes", "oncall"); run(40); set("Amara Reyes", "acw", { callEnded: {} }); run(1);
    expect(agent("Amara Reyes").shortCalls).toBe(2);
    expect(agent("Amara Reyes").calls).toBe(3);
    expect(of("Amara Reyes", "short").map(r => r.val)).toEqual(["10s call", "10s call"]);
  });

  it("needs at least 5 calls before the transfer-rate rule can fire", () => {
    const { set, run, of } = setup();
    const call = (transferred: boolean) => { set("Bea Santos", "oncall"); run(61); set("Bea Santos", "avail", { callEnded: { transferred } }); run(1); };
    for (let i = 0; i < 4; i++) call(true);
    expect(of("Bea Santos", "xfer")).toHaveLength(0);
    call(false);
    expect(of("Bea Santos", "xfer")).toHaveLength(1);
    expect(of("Bea Santos", "xfer")[0].val).toBe("80% (4/5)");
  });

  it("skips disabled rules", () => {
    const { e, episode, agent } = setup();
    e.setOn("acw", false);
    episode("Amara Reyes", "acw", 200);
    expect(e.S.ledger).toHaveLength(0);
    expect(agent("Amara Reyes").strikes).toEqual({});
  });
});

describe("the 3× rule", () => {
  it("climbs nudge → leader → ops on a full nudge ladder and opens an incident on strike 3", () => {
    const { e, episode, of, nudges, toasts } = setup();
    for (let i = 0; i < 3; i++) episode("Amara Reyes", "acw", 120);
    const rows = of("Amara Reyes", "acw").reverse();
    expect(rows.map(r => r.stage)).toEqual(["nudge", "lead", "ops"]);
    expect(rows.map(r => r.sev)).toEqual(["warn", "warn", "esc"]);
    expect(rows.map(r => r.inc)).toEqual(["", "", "INC-2026-0001"]);
    expect(e.S.incidents).toEqual([expect.objectContaining({ inc: "INC-2026-0001", agent: "Amara Reyes", ruleId: "acw", instances: 3, status: "Open", team: "Team Alpha" })]);
    expect(nudges).toHaveLength(1);
    expect(nudges[0]).toMatchObject({ agent: "Amara Reyes", first: "Amara" });
    expect(toasts.map(t => t.kind)).toEqual(["warn", "esc"]);
    expect(toasts[0].body).toContain("strike 2 · to TL Rina Velasco");
    expect(toasts[1]).toMatchObject({ title: "Ops escalation · Amara Reyes", body: "Extended ACW: strike 3. INC-2026-0001 opened · Mgr Ava Santiago notified." });
  });

  it("starts a TL-first ladder at the leader and still reaches ops on strike 3", () => {
    const { e, episode, of, nudges } = setup();
    for (let i = 0; i < 3; i++) episode("Miguel Cruz", "outb", 600);
    expect(of("Miguel Cruz", "outb").reverse().map(r => r.stage)).toEqual(["lead", "lead", "ops"]);
    expect(e.S.incidents).toHaveLength(1);
    expect(nudges).toHaveLength(0);
  });

  it("keeps one open incident per agent per rule and raises its instance count", () => {
    const { e, episode, of } = setup();
    for (let i = 0; i < 5; i++) episode("Amara Reyes", "acw", 120);
    expect(e.S.incidents).toHaveLength(1);
    expect(e.S.incidents[0].instances).toBe(5);
    expect(of("Amara Reyes", "acw").slice(0, 3).map(r => r.inc)).toEqual(["INC-2026-0001", "INC-2026-0001", "INC-2026-0001"]);
  });

  it("opens separate incidents per rule and per agent, and a new one after the first is closed", () => {
    const { e, episode } = setup();
    for (let i = 0; i < 3; i++) episode("Amara Reyes", "acw", 120);
    for (let i = 0; i < 3; i++) episode("Amara Reyes", "auxp", 300);
    for (let i = 0; i < 3; i++) episode("Joshua Lim", "acw", 120);
    expect(e.S.incidents.map(i => i.inc)).toEqual(["INC-2026-0003", "INC-2026-0002", "INC-2026-0001"]);

    expect(e.invAction("INC-2026-0001")!.status).toBe("Investigating");
    const closed = e.invAction("INC-2026-0001", "Validated / excused")!;
    expect(closed).toMatchObject({ status: "Closed", disposition: "Validated / excused", closedT: e.S.t });
    episode("Amara Reyes", "acw", 120);
    expect(e.S.incidents[0]).toMatchObject({ inc: "INC-2026-0004", agent: "Amara Reyes", ruleId: "acw", instances: 4, status: "Open" });
  });

  it("maps route and strike count to a stage", () => {
    expect([1, 2, 3, 4].map(n => stageFor("nudge", n))).toEqual(["nudge", "lead", "ops", "ops"]);
    expect([1, 2, 3, 4].map(n => stageFor("lead", n))).toEqual(["lead", "lead", "ops", "ops"]);
    expect([1, 2, 3, 9].map(n => stageFor("nudgeonly", n))).toEqual(["nudge", "nudge", "nudge", "nudge"]);
    expect([1, 2, 3, 9].map(n => stageFor("leadonly", n))).toEqual(["lead", "lead", "lead", "lead"]);
    expect(stageFor("lead", 0)).toBe("lead");
  });
});

describe("capped routes", () => {
  it("never climbs past the nudge and never opens an incident on nudge-only", () => {
    const { e, episode, of, nudges, toasts, agent } = setup();
    e.setRoute("acw", "nudgeonly");
    for (let i = 0; i < 5; i++) episode("Amara Reyes", "acw", 120);
    expect(of("Amara Reyes", "acw").map(r => r.stage)).toEqual(Array(5).fill("nudge"));
    expect(agent("Amara Reyes").strikes.acw).toBe(5);
    expect(e.S.incidents).toHaveLength(0);
    expect(nudges).toHaveLength(5);
    expect(toasts).toHaveLength(0);
  });

  it("stays with the TL and never opens an incident on TL-only", () => {
    const { e, episode, of, nudges } = setup();
    e.setRoute("acw", "leadonly");
    for (let i = 0; i < 5; i++) episode("Amara Reyes", "acw", 120);
    expect(of("Amara Reyes", "acw").map(r => r.stage)).toEqual(Array(5).fill("lead"));
    expect(of("Amara Reyes", "acw").every(r => r.inc === "")).toBe(true);
    expect(e.S.incidents).toHaveLength(0);
    expect(nudges).toHaveLength(0);
  });
});

describe("re-arm logic", () => {
  it("fires a duration rule once per state episode", () => {
    const { set, run, of } = setup();
    set("Amara Reyes", "acw");
    run(120);
    expect(of("Amara Reyes")).toHaveLength(0);
    run(1);
    expect(of("Amara Reyes")).toHaveLength(1);
    run(600);
    expect(of("Amara Reyes")).toHaveLength(1);
  });

  it("re-arms when the agent changes state", () => {
    const { episode, of } = setup();
    episode("Amara Reyes", "acw", 120);
    episode("Amara Reyes", "acw", 120);
    expect(of("Amara Reyes", "acw")).toHaveLength(2);
  });

  it("re-arms when the value drops back under the threshold without a state change", () => {
    const { set, run, of } = setup();
    set("Amara Reyes", "oncall", { onHold: true });
    run(121);
    expect(of("Amara Reyes", "hold")).toHaveLength(1);
    set("Amara Reyes", "oncall", { onHold: false });
    run(5);
    set("Amara Reyes", "oncall", { onHold: true });
    run(121);
    expect(of("Amara Reyes", "hold").map(r => r.strikes)).toEqual([2, 1]);
  });

  it("fires adherence once per shift and never re-arms it", () => {
    const { set, run, of } = setup();
    set("Amara Reyes", "avail", { adh: 85 }); run(2);
    set("Amara Reyes", "avail", { adh: 95 }); run(2);
    set("Amara Reyes", "acw", { adh: 84 }); run(2);
    expect(of("Amara Reyes", "adh")).toHaveLength(1);
    expect(of("Amara Reyes", "adh")[0].val).toBe("85%");
  });

  it("fires transfer rate once per shift and never re-arms it", () => {
    const { set, run, of } = setup();
    const call = (transferred: boolean) => { set("Bea Santos", "oncall"); run(61); set("Bea Santos", "avail", { callEnded: { transferred } }); run(1); };
    for (let i = 0; i < 5; i++) call(true);
    for (let i = 0; i < 20; i++) call(false); // rate falls to 20%
    for (let i = 0; i < 10; i++) call(true); // and climbs back over 25%
    expect(of("Bea Santos", "xfer")).toHaveLength(1);
  });

  it("evaluates offline agents only against Prolonged offline", () => {
    const { set, run, of } = setup();
    set("Amara Reyes", "off", { adh: 80 });
    run(601);
    expect(of("Amara Reyes").map(r => r.ruleId)).toEqual(["offl"]);
    set("Amara Reyes", "avail"); run(1);
    expect(of("Amara Reyes").map(r => r.ruleId)).toEqual(["adh", "offl"]);
  });

  it("fires queue rules once per breach and re-arms them on recovery", () => {
    const { e, run } = setup();
    const q = (cq: number) => { e.ingest.onQueue({ cq, sl: 92, asa: 18, ab: 2 }); run(1); };
    q(3); q(12); q(14); q(11);
    expect(e.S.ledger.map(r => r.ruleId)).toEqual(["cq"]);
    expect(e.S.ledger[0]).toMatchObject({ agent: "Queue", team: "Floor", isFloor: true, stage: "lead", strikes: 0, inc: "", val: "12 calls waiting" });
    q(4); q(10);
    expect(e.S.ledger.map(r => r.ruleId)).toEqual(["cq", "cq"]);
    expect(e.S.incidents).toHaveLength(0);
  });

  it("freezes state timers while the feed is silent and fires the system rule at its threshold", () => {
    const { e, set, run, agent, toasts } = setup();
    set("Amara Reyes", "acw"); run(10);
    for (let i = 0; i < 29; i++) e.tick(); // no heartbeat
    expect(e.S.staleFor).toBe(29);
    expect(agent("Amara Reyes").stTime).toBe(9);
    expect(e.S.ledger).toHaveLength(0);
    e.tick();
    expect(e.S.ledger.map(r => r.ruleId)).toEqual(["gnr"]);
    expect(e.S.ledger[0].val).toBe("feed stale 30s, states may be outdated");
    for (let i = 0; i < 20; i++) e.tick();
    expect(e.S.ledger).toHaveLength(1);
    run(1);
    expect(e.S.staleFor).toBe(0);
    expect(agent("Amara Reyes").stTime).toBe(10);
    // The transient "not responding"/"recovered" toasts are suppressed (feed status lives in the
    // ContextBar); only the sustained-outage gnr escalation still toasts.
    expect(toasts.map(t => t.title)).toEqual(["Queue · Gencloud not responding · Critical"]);
    for (let i = 0; i < 30; i++) e.tick();
    expect(e.S.ledger.map(r => r.ruleId)).toEqual(["gnr", "gnr"]);
  });

  it("arms only the rules in breach after a quiet warm-up", () => {
    const { e, set, run, of, nudges } = setup();
    e.S.quiet = true;
    set("Amara Reyes", "acw"); run(200);
    e.S.quiet = false; e.rearm();
    expect(nudges).toHaveLength(0);
    run(60);
    expect(of("Amara Reyes", "acw")).toHaveLength(1);
  });
});

describe("scoping", () => {
  const admin: View = { role: "admin", who: null }, senior: View = { role: "senior", who: null };
  const mgr: View = { role: "mgr", who: "Ava Santiago" }, tl: View = { role: "tl", who: "Rina Velasco" };
  const agentV: View = { role: "agent", who: "Amara Reyes" };

  function floor() {
    const s = setup();
    for (const name of ["Amara Reyes", "Joshua Lim", "Bea Santos", "Miguel Cruz"]) for (let i = 0; i < 3; i++) s.episode(name, "acw", 120);
    s.e.ingest.onQueue({ cq: 12, sl: 92, asa: 18, ab: 2 }); s.run(1);
    return s;
  }
  const names = (rows: { agent: string }[]) => [...new Set(rows.map(r => r.agent))].sort();

  it("scopes teams and agents to the viewer's span", () => {
    const { e } = floor();
    expect(scopeTeams(e.S, admin).map(t => t.team)).toEqual(["Team Alpha", "Team Bravo", "Team Delta"]);
    expect(scopeTeams(e.S, senior)).toHaveLength(3);
    expect(scopeTeams(e.S, mgr).map(t => t.team)).toEqual(["Team Alpha", "Team Bravo"]);
    expect(scopeTeams(e.S, tl).map(t => t.team)).toEqual(["Team Alpha"]);
    expect(scopeTeams(e.S, agentV).map(t => t.team)).toEqual(["Team Alpha"]);
    expect(scopeAgents(e.S, admin)).toHaveLength(4);
    expect(scopeAgents(e.S, mgr).map(a => a.name)).toEqual(["Amara Reyes", "Joshua Lim", "Bea Santos"]);
    expect(scopeAgents(e.S, tl).map(a => a.name)).toEqual(["Amara Reyes", "Joshua Lim"]);
    expect(scopeAgents(e.S, agentV).map(a => a.name)).toEqual(["Amara Reyes"]);
    expect(scopeAgents(e.S, { role: "tl", who: "Nobody" })).toEqual([]);
  });

  it("scopes the ledger, with floor call-outs visible to every leader but not to agents", () => {
    const { e } = floor();
    const L = e.S.ledger;
    expect(scopeLedger(e.S, admin, L)).toHaveLength(13);
    expect(scopeLedger(e.S, senior, L)).toHaveLength(13);
    expect(names(scopeLedger(e.S, mgr, L))).toEqual(["Amara Reyes", "Bea Santos", "Joshua Lim", "Queue"]);
    expect(names(scopeLedger(e.S, tl, L))).toEqual(["Amara Reyes", "Joshua Lim", "Queue"]);
    expect(names(scopeLedger(e.S, agentV, L))).toEqual(["Amara Reyes"]);
    expect(inScope(e.S, agentV, L.find(r => r.isFloor)!)).toBe(false);
  });

  it("scopes incidents", () => {
    const { e } = floor();
    expect(scopeIncidents(e.S, admin, e.S.incidents)).toHaveLength(4);
    expect(names(scopeIncidents(e.S, mgr, e.S.incidents))).toEqual(["Amara Reyes", "Bea Santos", "Joshua Lim"]);
    expect(names(scopeIncidents(e.S, { role: "mgr", who: "Leo Fernandez" }, e.S.incidents))).toEqual(["Miguel Cruz"]);
    expect(names(scopeIncidents(e.S, tl, e.S.incidents))).toEqual(["Amara Reyes", "Joshua Lim"]);
    expect(names(scopeIncidents(e.S, agentV, e.S.incidents))).toEqual(["Amara Reyes"]);
  });

  it("bulk-acknowledges only inside the span", () => {
    const { e } = floor();
    expect(e.ackAll(tl)).toBe(7); // 2 agents × 3 + the queue call-out
    expect(e.S.ledger.filter(r => r.status === "open").map(r => r.agent).sort()).toEqual(Array(3).fill("Bea Santos").concat(Array(3).fill("Miguel Cruz")));
    expect(e.ackAll(tl)).toBe(0);
  });

  it("limits acknowledging and commenting to the right people", () => {
    const { e } = floor();
    const amara = e.S.ledger.find(r => r.agent === "Amara Reyes")!, miguel = e.S.ledger.find(r => r.agent === "Miguel Cruz")!;
    expect(canAck(e.S, tl, amara)).toBe(true);
    expect(canAck(e.S, tl, miguel)).toBe(false);
    expect(canAck(e.S, senior, amara)).toBe(false);
    expect(canAck(e.S, agentV, amara)).toBe(true);
    expect(canAck(e.S, agentV, miguel)).toBe(false);
    expect(canComment(agentV, amara)).toBe(true);
    expect(canComment(agentV, miguel)).toBe(false);
    expect(canComment(tl, amara)).toBe(false);
  });

  it("snaps an unknown person onto the first one for the role", () => {
    const { e } = floor();
    expect(resolveView(e.S, { role: "tl", who: "Nobody" })).toEqual({ role: "tl", who: "Rina Velasco" });
    expect(resolveView(e.S, { role: "mgr", who: "Leo Fernandez" })).toEqual({ role: "mgr", who: "Leo Fernandez" });
    expect(resolveView(e.S, { role: "admin", who: "Anyone" })).toEqual({ role: "admin", who: null });
  });

  it("matches the permission table", () => {
    const row = (r: keyof typeof PERMS) => { const p: Partial<(typeof PERMS)[typeof r]> = { ...PERMS[r] }; delete p.desc; return p; };
    expect(row("admin")).toEqual({ tabs: ["console", "dash", "rules", "ledger"], rulesEdit: true, invAct: true, export: true, ackAll: true, ir: true, replay: true });
    expect(row("senior")).toEqual({ tabs: ["dash"], rulesEdit: false, invAct: false, export: false, ackAll: false, ir: false, replay: false });
    expect(row("mgr")).toEqual({ tabs: ["console", "dash", "rules", "ledger"], rulesEdit: true, invAct: true, export: true, ackAll: false, ir: true, replay: true });
    expect(row("tl")).toEqual({ tabs: ["console", "dash", "ledger"], rulesEdit: false, invAct: false, export: false, ackAll: false, ir: false, replay: false });
    expect(row("agent")).toEqual({ tabs: ["myview"], rulesEdit: false, invAct: false, export: false, ackAll: false, ir: false, replay: false });
  });
});

describe("acknowledge and comment", () => {
  it("records the response time and keeps the first acknowledgement", () => {
    const { e, episode, run } = setup();
    episode("Amara Reyes", "acw", 120);
    const n = e.S.ledger[0].n, firedAt = e.S.ledger[0].t;
    run(20);
    expect(e.ack(n)).toMatchObject({ status: "acked", ackT: firedAt + 21 });
    run(20);
    expect(e.ack(n)!.ackT).toBe(firedAt + 21);
    expect(e.ack(9999)).toBeNull();
  });

  it("attaches a reason with or without acknowledging", () => {
    const { e, episode } = setup();
    episode("Amara Reyes", "acw", 120);
    episode("Amara Reyes", "acw", 120);
    const [second, first] = e.S.ledger;
    expect(e.comment(first.n, "Complex case", false)).toMatchObject({ cmt: "Complex case", status: "open" });
    expect(e.comment(second.n, "Member asked to hold", true)).toMatchObject({ cmt: "Member asked to hold", status: "acked" });
  });
});

describe("agent view helpers", () => {
  it("flags a breach and reports target status", () => {
    const { e, set, run, agent } = setup();
    set("Amara Reyes", "acw"); run(86);
    const a = agent("Amara Reyes");
    expect(isBreach(a, e.S.rules)).toBe(false);
    expect(myTargets(a, e.S.rules).find(t => t.id === "acw")).toMatchObject({ now: "1:25", stat: "Approaching", lvl: "watch" });
    run(40);
    expect(isBreach(a, e.S.rules)).toBe(true);
    expect(myTargets(a, e.S.rules).find(t => t.id === "acw")).toMatchObject({ stat: "Breached", lvl: "breach" });
    expect(myTargets(a, e.S.rules).map(t => t.id)).not.toContain("cq");
    e.setOn("acw", false);
    expect(myTargets(a, e.S.rules).find(t => t.id === "acw")).toMatchObject({ stat: "Rule off", lvl: "off" });
  });

  it("clamps threshold edits to a minimum of 1", () => {
    const { e } = setup();
    e.setThr("acw", "0"); expect(e.thr("acw")).toBe(120);
    e.setThr("acw", "-5"); expect(e.thr("acw")).toBe(1);
    e.setThr("acw", "45"); expect(e.thr("acw")).toBe(45);
    e.setThr("acw", "abc"); expect(e.thr("acw")).toBe(45);
  });
});
