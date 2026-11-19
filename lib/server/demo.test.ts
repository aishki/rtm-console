import { describe, expect, it } from "vitest";
import { createEngine } from "@/lib/engine/engine";
import { SimFeed } from "@/lib/feed/SimFeed";
import { CUE_RULE, canCue, demoViewWho, pickCueAgent, warmInChunks } from "./demo";
import type { Runtime } from "./runtime";

const floor = () => {
  const engine = createEngine({}, { deriveAdh: true });
  const feed = new SimFeed({ thr: engine.thr, strikes: (uid, id) => engine.S.agents.find(a => a.uid === uid)?.strikes[id] ?? 0 }, Math.random, undefined, { kind: "demo" });
  engine.reset({ t: 8 * 3600 });
  feed.subscribe(engine.ingest);
  return { engine, feed };
};

describe("the cue agent", () => {
  it("is someone working on the largest team, with no Overbreak strike, and not the last one", () => {
    const { engine } = floor();
    const S = engine.S;
    const first = pickCueAgent(S)!;
    const a = S.agents.find(x => x.uid === first)!;
    const sizes = new Map<string, number>();
    for (const x of S.agents) sizes.set(x.team, (sizes.get(x.team) ?? 0) + 1);
    expect(sizes.get(a.team)).toBe(Math.max(...sizes.values()));
    expect(a.state).not.toBe("off");

    const next = pickCueAgent(S, first)!;
    expect(next).not.toBe(first);
    S.agents.find(x => x.uid === next)!.strikes[CUE_RULE] = 1;
    expect(pickCueAgent(S, first)).not.toBe(next);
  });

  it("is nobody on an empty floor", () => {
    expect(pickCueAgent({ agents: [] })).toBeNull();
  });
});

describe("who may press the cue keys", () => {
  const on = (kind: string) => ({ feed: { kind } }) as unknown as Runtime;
  it("is an Admin, or any view while View as is on, and only on the demo floor", () => {
    expect(canCue(on("demo"), { feed: true }, false)).toBe(true);
    expect(canCue(on("demo"), { feed: false }, true)).toBe(true);
    expect(canCue(on("demo"), { feed: false }, false)).toBe(false);
    expect(canCue(on("sim"), { feed: true }, true)).toBe(false);
  });
});

describe("where a role switch lands on the demo floor", () => {
  const people = { "demo:1": { name: "A", supervisor: "demo:lead:1" }, "demo:lead:1": { name: "L", supervisor: "demo:lead:2" }, "demo:lead:2": { name: "M", supervisor: null } };
  const rt = (kind: string, cueAgent: string | null) => ({ feed: { kind }, engine: { S: { people } }, demo: { cueAgent, warming: false } }) as unknown as Runtime;
  it("follows the cue agent: their own view, their Team Lead, their Manager", () => {
    expect(demoViewWho(rt("demo", "demo:1"), "agent")).toBe("demo:1");
    expect(demoViewWho(rt("demo", "demo:1"), "tl")).toBe("demo:lead:1");
    expect(demoViewWho(rt("demo", "demo:1"), "mgr")).toBe("demo:lead:2");
    expect(demoViewWho(rt("demo", "demo:1"), "admin")).toBeNull();
  });
  it("leaves the default alone off the demo floor or with no cue agent yet", () => {
    expect(demoViewWho(rt("sim", "demo:1"), "tl")).toBeNull();
    expect(demoViewWho(rt("demo", null), "tl")).toBeNull();
  });
});

describe("the warm-up", () => {
  it("runs the floor clock forward quietly and leaves a history, mostly acknowledged", async () => {
    const { engine, feed } = floor();
    const t0 = engine.S.t;
    await warmInChunks({ engine, feed }, 1800, () => false);
    const S = engine.S;
    expect(S.t).toBe(t0 + 1800);
    expect(S.quiet).toBe(false);
    expect(S.agentsLoading).toBe(false);
    const agentRows = S.ledger.filter(r => !r.isFloor);
    expect(agentRows.length).toBeGreaterThan(10);
    const share = agentRows.filter(r => r.status === "acked").length / agentRows.length;
    expect(share).toBeGreaterThan(0.4);
  });

  it("stops when the floor is switched away", async () => {
    const { engine, feed } = floor();
    const t0 = engine.S.t;
    let stopped = false;
    const run = warmInChunks({ engine, feed }, 10_000, () => stopped);
    setImmediate(() => { stopped = true; });
    await run;
    expect(engine.S.t - t0).toBeLessThan(10_000);
    expect(engine.S.agentsLoading).toBe(false);
  });
});
