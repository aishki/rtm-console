import { describe, expect, it } from "vitest";
import { buildTree, UNMAPPED } from "./queueTree";
import type { QueueMapRow } from "./import/queueMap";

const row = (tower: string, subTower: string, lob: string, queue: string): QueueMapRow => ({ tower, subTower, lob, queue });

describe("buildTree", () => {
  it("nests tower → sub-tower → LOB → queue", () => {
    const t = buildTree(["CSBD_X"], [row("Provider Services", "CSBD - Provider", "ROM EAST", "CSBD_X")], { CSBD_X: [7] });
    const path = [t[0], t[0].children[0], t[0].children[0].children[0], t[0].children[0].children[0].children[0]];
    expect(path.map(n => n.level)).toEqual(["tower", "subTower", "lob", "queue"]);
    expect(path.map(n => n.label)).toEqual(["Provider Services", "CSBD - Provider", "ROM EAST", "CSBD_X"]);
    expect(path[3].key).toBe("t:Provider Services/s:CSBD - Provider/l:ROM EAST/q:CSBD_X");
    expect(path[0].queues).toEqual(["CSBD_X"]);
    expect(path[3].agentIds).toEqual([7]);
  });
  it("matches sheet names to feed names ignoring case and spaces", () => {
    const t = buildTree(["csbd_cnx_host_prov_east_ga "], [row("Provider Services", "CSBD - Provider", "ROM EAST", "CSBD_CNX_HOST_PROV_EAST_GA")], {});
    expect(t[0].label).toBe("Provider Services");
    expect(t[0].children[0].children[0].children[0].label).toBe("csbd_cnx_host_prov_east_ga ");
  });
  it("puts unmapped queues last, directly under Unmapped", () => {
    const t = buildTree(["Z", "A"], [row("T", "S", "L", "Z")], { A: [1] });
    expect(t.map(n => n.label)).toEqual(["T", UNMAPPED]);
    const un = t[1];
    expect(un.level).toBe("tower");
    expect(un.children.map(c => [c.level, c.label])).toEqual([["queue", "A"]]);
    expect(un.agentIds).toEqual([1]);
  });
  it("counts a person once above the queue level", () => {
    const t = buildTree(["Q1", "Q2"], [row("T", "S", "L", "Q1"), row("T", "S", "L", "Q2")], { Q1: [1, 2], Q2: [2, 3] });
    expect(t[0].agentIds).toEqual([1, 2, 3]);
    expect(t[0].children[0].children[0].children.map(q => q.agentIds)).toEqual([[1, 2], [2, 3]]);
  });
  it("dedupes big queues in linear time, keeping first-seen order", () => {
    const ids = Array.from({ length: 60000 }, (_, i) => i);
    const start = performance.now();
    const t = buildTree(["Q1", "Q2"], [row("T", "S", "L", "Q1"), row("T", "S", "L", "Q2")], { Q1: ids, Q2: [...ids].reverse() });
    expect(performance.now() - start).toBeLessThan(1000);
    expect(t[0].agentIds).toEqual(ids);
  });
  it("is a flat Unmapped tower with no mapping", () => {
    const t = buildTree(["Team B", "Team A"], [], { "Team A": [1], "Team B": [2] });
    expect(t).toHaveLength(1);
    expect(t[0].label).toBe(UNMAPPED);
    expect(t[0].children.map(c => c.label)).toEqual(["Team A", "Team B"]);
    expect(t[0].queues).toEqual(["Team A", "Team B"]);
  });
  it("sorts siblings by label", () => {
    const t = buildTree(["Q1", "Q2"], [row("B", "S", "L", "Q1"), row("A", "S", "L", "Q2")], {});
    expect(t.map(n => n.label)).toEqual(["A", "B"]);
  });
  it("keeps a repeated queue once", () => {
    const t = buildTree(["Q1", "q1 "], [row("T", "S", "L", "Q1")], { Q1: [1] });
    expect(t[0].queues).toEqual(["Q1"]);
  });
  it("uses the first map row when a queue is mapped twice", () => {
    const t = buildTree(["Q1"], [row("First", "S", "L", "Q1"), row("Second", "S", "L", "q1")], {});
    expect(t.map(n => n.label)).toEqual(["First"]);
  });
  it("ignores map rows for queues the feed does not watch", () => {
    const t = buildTree(["Q1"], [row("T", "S", "L", "Q1"), row("Other", "S", "L", "Q9")], {});
    expect(t.map(n => n.label)).toEqual(["T"]);
  });
});
