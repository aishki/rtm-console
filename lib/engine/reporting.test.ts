import { describe, expect, it } from "vitest";
import type { OrgPerson, RosterAgent, Team, ToastEvent, View } from "@/lib/types";
import { createEngine } from "./engine";
import { NO_LEADER } from "./format";
import { chainAbove, inScope, leadersOf, peopleFor, resolveView, scopeAgents, scopeIncidents, scopeTeams, unsupervised, viewerName } from "./scope";
import { teamLines } from "@/lib/feed/teamLines";

// Reporting lines, invented: two Team Leads under one Manager, who reports to a director.
//   dir ─ mgr ─┬─ tl1 ─ a1, a2
//              └─ tl2 ─ a3
//   a4 has no supervisor; a5 reports straight to the Manager.
const ORG: Team[] = [{ team: "Queue One", tl: "", mgr: "", lob: "Queue One" }, { team: "Queue Two", tl: "", mgr: "", lob: "Queue Two" }];
const AGENTS: RosterAgent[] = [
  { uid: "a1", name: "Agent, One - AA00001", team: "Queue One", state: "avail" },
  { uid: "a2", name: "Agent, Two - AA00002", team: "Queue One", state: "avail" },
  { uid: "a3", name: "Agent, Three - AA00003", team: "Queue Two", state: "avail" },
  { uid: "a4", name: "Agent, Four - AA00004", team: "Queue Two", state: "avail" },
  { uid: "a5", name: "Agent, Five - AA00005", team: "Queue Two", state: "avail" },
];
const P = (uid: string, name: string, supervisor: string | null): OrgPerson => ({ uid, name, supervisor });
const PEOPLE: OrgPerson[] = [
  P("dir", "Lead, Dana", null), P("mgr", "Lead, Morgan", "dir"), P("tl1", "Lead, Tess", "mgr"), P("tl2", "Lead, Ravi", "mgr"),
  P("a1", AGENTS[0].name, "tl1"), P("a2", AGENTS[1].name, "tl1"), P("a3", AGENTS[2].name, "tl2"), P("a4", AGENTS[3].name, null), P("a5", AGENTS[4].name, "mgr"),
];

function floor() {
  const toasts: ToastEvent[] = [];
  const e = createEngine({ toast: t => toasts.push(t) }, { year: () => 2026 });
  e.reset({ t: 8 * 3600 });
  e.ingest.onRoster({ org: ORG, agents: AGENTS, people: PEOPLE });
  const run = (s: number) => { for (let i = 0; i < s; i++) { e.ingest.onHeartbeat(); e.tick(); } };
  return { e, toasts, run };
}
const uids = (xs: { uid: string }[]) => xs.map(x => x.uid).sort();

describe("reporting lines", () => {
  it("finds each agent's Team Lead and Manager", () => {
    const { e } = floor();
    expect(chainAbove(e.S.people, "a1")).toEqual(["tl1", "mgr", "dir"]);
    expect(leadersOf(e.S.people, "a1")).toEqual({ tl: { key: "tl1", name: "Lead, Tess" }, mgr: { key: "mgr", name: "Lead, Morgan" } });
    expect(leadersOf(e.S.people, "a5")).toEqual({ tl: { key: "mgr", name: "Lead, Morgan" }, mgr: { key: "dir", name: "Lead, Dana" } });
    expect(leadersOf(e.S.people, "a4")).toEqual({ tl: null, mgr: null });
  });

  it("stops at a loop in the data", () => {
    const people = { x: { name: "X", supervisor: "y" }, y: { name: "Y", supervisor: "x" } };
    expect(chainAbove(people, "x")).toEqual(["y"]);
  });

  it("gives a Team Lead their direct reports and a Manager everyone below them", () => {
    const { e } = floor();
    expect(uids(scopeAgents(e.S, { role: "tl", who: "tl1" }))).toEqual(["a1", "a2"]);
    expect(uids(scopeAgents(e.S, { role: "mgr", who: "mgr" }))).toEqual(["a1", "a2", "a3", "a5"]);
    expect(uids(scopeAgents(e.S, { role: "mgr", who: "dir" }))).toEqual(["a1", "a2", "a3", "a5"]);
    expect(uids(scopeAgents(e.S, { role: "mgr", who: "tl2" }))).toEqual(["a3"]);
    expect(uids(scopeAgents(e.S, { role: "admin", who: null }))).toHaveLength(5);
    expect(scopeTeams(e.S, { role: "tl", who: "tl1" }).map(t => t.team)).toEqual(["Queue One"]);
    expect(scopeTeams(e.S, { role: "tl", who: "tl2" }).map(t => t.team)).toEqual(["Queue Two"]);
  });

  it("shows an agent with no supervisor to Admin and Senior Leader only", () => {
    const { e } = floor();
    const r = { agentId: "a4", isFloor: false };
    expect(inScope(e.S, { role: "admin", who: null }, r)).toBe(true);
    expect(inScope(e.S, { role: "senior", who: null }, r)).toBe(true);
    for (const v of [{ role: "tl", who: "tl1" }, { role: "mgr", who: "dir" }] as View[]) expect(inScope(e.S, v, r)).toBe(false);
    expect(unsupervised(e.S)).toEqual([{ uid: "a4", name: AGENTS[3].name, team: "Queue Two" }]);
  });

  it("lists Team Leads and Managers for View as, by name, and keys views by uid", () => {
    const { e } = floor();
    expect(peopleFor(e.S, "tl").map(p => p.key)).toEqual(["mgr", "tl2", "tl1"]);
    expect(peopleFor(e.S, "mgr").map(p => p.key)).toEqual(["dir", "mgr"]);
    expect(resolveView(e.S, { role: "tl", who: "tl2" })).toEqual({ role: "tl", who: "tl2" });
    expect(viewerName({ role: "mgr", who: "mgr" }, e.S)).toBe("Lead, Morgan");
    expect(viewerName({ role: "agent", who: "a1" }, e.S)).toBe(AGENTS[0].name);
  });

  it("names the agent's own leaders in alerts, and says when there is none", () => {
    const { e, toasts, run } = floor();
    e.setRoute("acw", "lead");
    for (const uid of ["a1", "a4"]) { e.ingest.onAgentState({ uid, state: "acw" }); }
    run(e.thr("acw") + 1);
    expect(toasts.find(t => t.title.startsWith("Agent, One"))?.body).toContain("to TL Lead, Tess");
    expect(toasts.find(t => t.title.startsWith("Agent, Four"))?.body).toContain(`to TL ${NO_LEADER}`);
  });

  it("scopes incidents by the agent's line, not the queue", () => {
    const { e } = floor();
    e.S.incidents.push(
      { inc: "INC-2026-0001", t: 0, agent: AGENTS[0].name, agentId: "a1", team: "Queue One", rule: "Extended ACW", ruleId: "acw", instances: 3, status: "Open", disposition: "", closedT: null },
      { inc: "INC-2026-0002", t: 0, agent: AGENTS[2].name, agentId: "a3", team: "Queue Two", rule: "Extended ACW", ruleId: "acw", instances: 3, status: "Open", disposition: "", closedT: null },
    );
    expect(scopeIncidents(e.S, { role: "tl", who: "tl1" }, e.S.incidents).map(i => i.agentId)).toEqual(["a1"]);
    expect(scopeIncidents(e.S, { role: "mgr", who: "mgr" }, e.S.incidents)).toHaveLength(2);
  });

  it("keeps reporting lines across a roster without them, and adds lines that arrive later", () => {
    const { e } = floor();
    const rev = e.S.rosterRev;
    e.ingest.onRoster({ org: ORG, agents: AGENTS });
    expect(e.S.people.a1.supervisor).toBe("tl1");
    e.ingest.onPeople!([P("a4", AGENTS[3].name, "tl2")]);
    expect(e.S.people.a4.supervisor).toBe("tl2");
    expect(e.S.rosterRev).toBe(rev + 2);
    e.reset({ t: 0 });
    expect(e.S.people).toEqual({});
  });
});

describe("teamLines", () => {
  it("puts each team's agents under its Team Lead, and the Team Lead under the Manager", () => {
    const lines = teamLines(
      [{ team: "A", tl: "Tess", mgr: "Morgan" }, { team: "B", tl: "Ravi", mgr: "Morgan" }],
      [{ uid: "sim:x", name: "X", team: "A" }, { uid: "sim:y", name: "Y", team: "B" }],
      "sim:",
    );
    expect(lines).toEqual([
      { uid: "sim:lead:Morgan", name: "Morgan", supervisor: null },
      { uid: "sim:lead:Tess", name: "Tess", supervisor: "sim:lead:Morgan" },
      { uid: "sim:lead:Ravi", name: "Ravi", supervisor: "sim:lead:Morgan" },
      { uid: "sim:x", name: "X", supervisor: "sim:lead:Tess" },
      { uid: "sim:y", name: "Y", supervisor: "sim:lead:Ravi" },
    ]);
  });

  it("does not make a leader their own supervisor", () => {
    const lines = teamLines([{ team: "A", tl: "Sam", mgr: "Sam" }], [], "csv:");
    expect(lines).toEqual([{ uid: "csv:lead:Sam", name: "Sam", supervisor: null }]);
  });
});
