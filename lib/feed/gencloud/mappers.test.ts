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
  it("aggregates across queues without NaN", () => {
    const q = aggregateQueue(
      [{queueId:"q1",waiting:3,interacting:0,onQueueUsers:0,offQueueUsers:0,serviceLevelPct:90},
       {queueId:"q2",waiting:2,interacting:0,onQueueUsers:0,offQueueUsers:0,serviceLevelPct:70}],
      [{queueId:"q1",offered:10,answered:9,abandoned:1,asaSec:20,avgHandleSec:300},
       {queueId:"q2",offered:0,answered:0,abandoned:0,asaSec:null,avgHandleSec:null}]);
    expect(q.cq).toBe(5);
    expect(q.sl).toBeCloseTo(80);
    expect(q.asa).toBeCloseTo(20);
    expect(q.ab).toBeCloseTo(10);
  });
  it("empty inputs -> zeros, not NaN", () => {
    const q = aggregateQueue([], []);
    expect(q).toEqual({ cq:0, sl:0, asa:0, ab:0 });
  });
});
