import { describe, it, expect } from "vitest";
import { buildRoster, aggregateQueue } from "./mappers";

describe("buildRoster", () => {
  it("one team per queue, agents deduped to first queue", () => {
    const r = buildRoster(
      [{id:"q1",name:"Alpha"},{id:"q2",name:"Bravo"}],
      { q1:[{id:"u1",name:"Amara"},{id:"u2",name:"Bea"}], q2:[{id:"u1",name:"Amara"}] });
    expect(r.org).toEqual([
      { team:"Alpha", tl:"", mgr:"", lob:"Alpha" },
      { team:"Bravo", tl:"", mgr:"", lob:"Bravo" }]);
    expect(r.agents.map(a=>[a.name,a.team])).toEqual([["Amara","Alpha"],["Bea","Alpha"]]);
    expect(r.agents.every(a=>a.state==="off")).toBe(true);
    expect(r.idToName.u1).toBe("Amara");
  });
});

describe("aggregateQueue", () => {
  const obs = (queueId: string, waiting: number) => ({ queueId, waiting, interacting:0, onQueueUsers:0, offQueueUsers:0, serviceLevelPct:null });
  it("weights service level and ASA by calls, not by queue", () => {
    const q = aggregateQueue([obs("q1", 3), obs("q2", 2)], [
      { queueId:"q1", offered:100, answered:90, abandoned:10, asaSec:20, avgHandleSec:300, answerSec:1800, slWithin:80, slCounted:100 },
      { queueId:"q2", offered:10, answered:10, abandoned:0, asaSec:100, avgHandleSec:300, answerSec:1000, slWithin:1, slCounted:10 }]);
    expect(q.cq).toBe(5);
    expect(q.sl).toBeCloseTo((81 / 110) * 100);   // not the per-queue mean of 80% and 10%
    expect(q.asa).toBeCloseTo(2800 / 100);
    expect(q.ab).toBeCloseTo((10 / 110) * 100);
  });
  it("empty inputs: no service level yet (null, not 0%), other numbers zero", () => {
    expect(aggregateQueue([], [])).toEqual({ cq:0, sl:null, asa:0, ab:0 });
  });
});
