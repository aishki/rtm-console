import { describe, expect, it } from "vitest";
import { type GridFilter, autoOpenQueues, expandAllKeys, filterTree, flatten } from "./gridFilter";
import type { QueueMapRow } from "./import/queueMap";
import { buildTree } from "./queueTree";

const row = (lob: string, queue: string): QueueMapRow => ({ tower: "T", subTower: "S", lob, queue });
const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);
const NONE: GridFilter = { query: "", queue: "", inScope: null, queryHits: new Set() };
const queuesOf = (nodes: ReturnType<typeof flatten>) => nodes.filter(n => n.level === "queue");

// Two LOBs: CARDS_EN (1, 2), CARDS_ES (2, 3) and LOANS (4).
const small = () => buildTree(
  ["CARDS_EN", "CARDS_ES", "LOANS"],
  [row("Cards", "CARDS_EN"), row("Cards", "CARDS_ES"), row("Loans", "LOANS")],
  { CARDS_EN: [1, 2], CARDS_ES: [2, 3], LOANS: [4] },
);

// 81 queues of 100 people each, all named ROM_*.
const big = () => {
  const names = range(0, 81).map(i => `ROM_${i}`);
  return buildTree(names, names.map(n => row("ROM", n)), Object.fromEntries(names.map((n, i) => [n, range(i * 100, 100)])));
};

describe("filterTree", () => {
  it("keeps the queues holding a person whose name or team lead matches", () => {
    const v = filterTree(small(), { ...NONE, query: "zz", queryHits: new Set([3]) });
    expect(queuesOf(flatten(v.nodes)).map(n => n.label)).toEqual(["CARDS_ES"]);
    expect(v.shown.get(v.nodes[0].key)).toEqual([3]);
    expect(v.agentCount).toBe(1);
    expect(v.queueCount).toBe(1);
  });

  it("a queue-name search finds that queue with its members", () => {
    const v = filterTree(small(), { ...NONE, query: "loans" });
    const qs = queuesOf(flatten(v.nodes));
    expect(qs.map(n => n.label)).toEqual(["LOANS"]);
    expect(v.shown.get(qs[0].key)).toEqual([4]);
  });

  it("a queue-name search keeps only the members in scope of the other filters", () => {
    const v = filterTree(small(), { ...NONE, query: "cards_en", inScope: new Set([2, 4]) });
    const qs = queuesOf(flatten(v.nodes));
    expect(qs.map(n => n.label)).toEqual(["CARDS_EN"]);
    expect(v.shown.get(qs[0].key)).toEqual([2]);
  });

  it("counts a person once above the queue level", () => {
    const v = filterTree(small(), { ...NONE, inScope: new Set([1, 2, 3]) });
    const cards = flatten(v.nodes).find(n => n.label === "Cards")!;
    expect(v.shown.get(cards.key)).toEqual([1, 2, 3]);
    expect(v.agentCount).toBe(3);
  });

  it("the queue filter keeps that branch, empty queues included", () => {
    const t = buildTree(["A", "B"], [row("L", "A"), row("L", "B")], {});
    const v = filterTree(t, { ...NONE, queue: "B" });
    expect(queuesOf(flatten(v.nodes)).map(n => n.label)).toEqual(["B"]);
  });
});

describe("autoOpenQueues", () => {
  it("a search with a small result opens its queues", () => {
    const v = filterTree(small(), { ...NONE, query: "cards" });
    expect([...autoOpenQueues(v, "cards")].sort()).toEqual(queuesOf(flatten(v.nodes)).map(n => n.key).sort());
    expect(autoOpenQueues(v, "cards").size).toBe(2);
  });

  it("a broad search does not open more than 5 queues / 300 cards", () => {
    const wide = filterTree(big(), { ...NONE, query: "rom" });
    expect(wide.queueCount).toBe(81);
    expect(autoOpenQueues(wide, "rom").size).toBe(0);

    // ROM_7 and ROM_70–79: eleven queues.
    const eleven = filterTree(big(), { ...NONE, query: "rom_7" });
    expect(eleven.queueCount).toBe(11);
    expect(autoOpenQueues(eleven, "rom_7").size).toBe(0);

    // Four queues stay under the queue limit but draw 304 cards; five light ones open.
    const heavy = filterTree(big(), { ...NONE, query: "x", queryHits: new Set(range(0, 304)) });
    expect(heavy.queueCount).toBe(4);
    expect(autoOpenQueues(heavy, "x").size).toBe(0);
    const light = filterTree(big(), { ...NONE, query: "x", queryHits: new Set([0, 100, 200, 300, 400]) });
    expect(autoOpenQueues(light, "x").size).toBe(5);
  });

  it("state filter alone keeps queues closed", () => {
    const v = filterTree(small(), { ...NONE, inScope: new Set([1]) });
    expect(v.queueCount).toBe(1);
    expect(autoOpenQueues(v, "").size).toBe(0);
  });
});

describe("expandAllKeys", () => {
  it("Expand all never opens queues", () => {
    const t = small();
    const keys = expandAllKeys(t);
    const levels = flatten(t).filter(n => keys.includes(n.key)).map(n => n.level);
    expect(levels).toEqual(["tower", "subTower", "lob", "lob"]);
  });
});
