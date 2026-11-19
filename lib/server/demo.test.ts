import { describe, expect, it } from "vitest";
import { createEngine } from "@/lib/engine/engine";
import { SimFeed } from "@/lib/feed/SimFeed";
import { CUE_RULE, pickCueAgent, warmInChunks } from "./demo";

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
