import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { teamLines } from "@/lib/feed/teamLines";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEngine } from "@/lib/engine/engine";
import type { Team, View } from "@/lib/types";
import type { Runtime } from "./runtime";
import { queueMapRev, saveQueueMap } from "./queueMapStore";
import { memoryStore } from "@/lib/store/memory";
import { type Since, initMsg, newSent, tickMsg } from "./snapshot";

const ORG: Team[] = [
  { team: "Team Alpha", tl: "Rina Velasco", mgr: "Ava Santiago", lob: "PAP Intake" },
  { team: "Team Bravo", tl: "Marco Tan", mgr: "Ava Santiago", lob: "PAP Intake" },
];
const AGENTS = [
  { uid: "u-amara", name: "Amara Reyes", team: "Team Alpha", state: "avail" as const },
  { uid: "u-joshua", name: "Joshua Lim", team: "Team Alpha", state: "avail" as const },
  { uid: "u-bea", name: "Bea Santos", team: "Team Bravo", state: "avail" as const },
];
const BATCH = { toasts: [], nudges: [] };
const ADMIN: View = { role: "admin", who: null };

function setup() {
  const engine = createEngine({});
  engine.reset({ t: 8 * 3600 });
  engine.ingest.onRoster({ org: ORG, agents: AGENTS, people: teamLines(ORG, AGENTS, "") });
  const rt = { engine } as unknown as Runtime;
  const now = (): Since => ({ rev: engine.S.rev, rosterRev: engine.S.rosterRev, mapRev: queueMapRev() });
  return { engine, rt, now };
}

describe("tickMsg queue data", () => {
  it("sends membership and the mapping on the first snapshot", () => {
    const { rt, engine } = setup();
    const m = tickMsg(rt, ADMIN, null, BATCH);
    expect(m.members).toEqual({ "Team Alpha": [0, 1], "Team Bravo": [2] });
    expect(Array.isArray(m.queueMap)).toBe(true);
    expect(m.queues).toBe(engine.S.queues);
  });

  it("leaves them out while nothing changed", () => {
    const { rt, now } = setup();
    const m = tickMsg(rt, ADMIN, now(), BATCH);
    expect(m.members).toBeUndefined();
    expect(m.queueMap).toBeUndefined();
    expect(m.queues).toBeDefined();
  });

  it("resends membership after the roster reloads", () => {
    const { rt, engine, now } = setup();
    const since = now();
    engine.ingest.onRoster({ org: ORG, agents: AGENTS, people: teamLines(ORG, AGENTS, "") });
    const m = tickMsg(rt, ADMIN, since, BATCH);
    expect(m.members).toBeDefined();
    expect(m.queueMap).toBeUndefined();
  });

  it("resends the mapping after an upload", async () => {
    const { rt, now } = setup();
    const since = now();
    // Saving to a scratch dir keeps the real mapping untouched; the rev still moves, which is what the stream watches.
    await saveQueueMap([{ tower: "Voice", subTower: "Billing", lob: "Cards", queue: "Team Alpha" }], null, memoryStore({ dir: mkdtempSync(path.join(tmpdir(), "snap-")) }));
    expect(tickMsg(rt, ADMIN, since, BATCH).queueMap).toBeDefined();
  });

  it("scopes membership to the viewer's agents", () => {
    const { rt } = setup();
    const m = tickMsg(rt, { role: "tl", who: "lead:Rina Velasco" }, null, BATCH);
    expect(m.members).toEqual({ "Team Alpha": [0, 1], "Team Bravo": [] });
    const agent = tickMsg(rt, { role: "agent", who: "u-bea" }, null, BATCH);
    expect(agent.members).toEqual({ "Team Alpha": [], "Team Bravo": [2] });
  });
});

describe("tickMsg deltas for one connection", () => {
  /** A connection that has had its snapshot, as the stream route keeps it. */
  function connected() {
    const s = setup();
    const rt = { ...s.rt, feed: { kind: "sim" }, pendingNudge: () => null } as unknown as Runtime;
    const sent = newSent();
    const init = initMsg(rt, ADMIN, sent);
    let since = s.now();
    /** The next tick's message, as the stream route would send it. */
    const next = (batch = { toasts: [], nudges: [] }) => { const m = tickMsg(rt, ADMIN, since, batch, sent); since = s.now(); return m; };
    return { ...s, rt, init, next };
  }

  it("sends everything on connect, then nothing that has not changed", () => {
    const { init, engine, next } = connected();
    expect(init.agents).toHaveLength(3);
    expect(init.rules).toBeDefined();
    expect(init.incidents).toBeDefined();
    expect(init.org).toBeDefined();
    expect(init.queues).toBeDefined();
    engine.tick();
    const m = next();
    expect(m.agents).toBeUndefined();
    expect(m.agentsChanged).toBeUndefined();
    expect(m.rules).toBeUndefined();
    expect(m.incidents).toBeUndefined();
    expect(m.org).toBeUndefined();
    expect(m.queues).toBeUndefined();
  });

  it("sends only the agent whose state changed, with when it began", () => {
    const { engine, next } = connected();
    engine.ingest.onAgentState({ uid: "u-bea", state: "acw" });
    engine.tick();
    const m = next();
    expect(m.agents).toBeUndefined();
    expect(m.agentsChanged).toHaveLength(1);
    expect(m.agentsChanged![0]).toMatchObject({ uid: "u-bea", state: "acw", stAt: engine.S.agentT });
    expect(m.agentsChanged![0]).not.toHaveProperty("stTime");
  });

  it("resends nothing while the feed is silent: the agents' clock holds with their timers", () => {
    const { engine, next } = connected();
    engine.tick(); // the roster load counts as a heartbeat: timers move with the clock
    expect(next().agentsChanged).toBeUndefined();
    const at = engine.S.agentT;
    // Then no heartbeat and no states: the engine holds every timer while the shift clock moves on.
    for (let i = 0; i < 5; i++) { engine.tick(); expect(next().agentsChanged).toBeUndefined(); }
    expect(engine.S.agentT).toBe(at);
    expect(next().agentT).toBe(at);
  });

  it("sends a rule change once", () => {
    const { engine, next } = connected();
    engine.S.rules = engine.S.rules.map(r => (r.id === "acw" ? { ...r, thr: r.thr + 30 } : r));
    expect(next().rules).toBeDefined();
    expect(next().rules).toBeUndefined();
  });

  it("sends the whole list again after the roster reloads", () => {
    const { engine, next } = connected();
    engine.ingest.onRoster({ org: ORG, agents: AGENTS, people: teamLines(ORG, AGENTS, "") });
    expect(next().agents).toHaveLength(3);
  });
});

describe("tickMsg on the demo floor", () => {
  const nudge = (agentId: string, n: number) => ({ n, agentId, agent: "x", team: "Team Alpha", first: "x", body: "b" });
  const toast = (agentId: string, n: number) => ({ kind: "warn" as const, title: "t", body: "b", instance: { n, agentId, team: "Team Alpha", isFloor: false } as never });
  const demoRt = (rt: Runtime) => ({ ...rt, feed: { kind: "demo" }, demo: { cueAgent: "u-amara", warming: false } }) as unknown as Runtime;

  it("shows the presenter the cue agent's nudge and toasts, and nobody else's", () => {
    const { rt } = setup();
    const batch = { nudges: [nudge("u-amara", 1), nudge("u-joshua", 2)], toasts: [toast("u-amara", 1), toast("u-joshua", 2)] };
    const m = tickMsg(demoRt(rt), ADMIN, null, batch);
    expect(m.nudges.map(n => n.n)).toEqual([1]);
    expect(m.toasts.map(t => t.n)).toEqual([1]);
  });

  it("leaves other roles as they are, and the presenter role as before off the demo floor", () => {
    const { rt } = setup();
    const batch = { nudges: [nudge("u-amara", 1)], toasts: [toast("u-joshua", 2)] };
    expect(tickMsg(demoRt(rt), { role: "tl", who: null }, null, batch).nudges).toEqual([]);
    expect(tickMsg({ ...rt, feed: { kind: "sim" } } as unknown as Runtime, ADMIN, null, batch).nudges).toEqual([]);
    expect(tickMsg({ ...rt, feed: { kind: "sim" } } as unknown as Runtime, ADMIN, null, batch).toasts.map(t => t.n)).toEqual([2]);
  });
});
