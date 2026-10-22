import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QueueMapRow } from "@/lib/import/queueMap";
import { loadQueueMap, queueMapRev, saveQueueMap } from "./queueMapStore";

const ROWS: QueueMapRow[] = [
  { tower: "Voice", subTower: "Billing", lob: "Cards", queue: "CARDS_EN" },
  { tower: "Chat", subTower: "Care", lob: "Loans", queue: "LOANS_CHAT", region: "East" },
];

describe("queue map store", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "qmap-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("is empty when no file exists", () => {
    expect(loadQueueMap(dir)).toEqual([]);
  });

  it("round-trips what was saved", () => {
    saveQueueMap(ROWS, dir);
    expect(loadQueueMap(dir)).toEqual(ROWS);
  });

  it("bumps the rev on every save", () => {
    const before = queueMapRev();
    saveQueueMap(ROWS, dir);
    saveQueueMap([], dir);
    expect(queueMapRev()).toBe(before + 2);
  });

  it("drops malformed rows on load", () => {
    writeFileSync(path.join(dir, "queue-map.json"), JSON.stringify([
      ROWS[0], ROWS[1],
      { tower: "Voice", subTower: "Billing", lob: "Cards" },
      { tower: "", subTower: "Billing", lob: "Cards", queue: "Q" },
      { tower: "Voice", subTower: 3, lob: "Cards", queue: "Q" },
      { tower: "Voice", subTower: "Billing", lob: "Cards", queue: "Q", region: 5 },
      null, "row", 7,
    ]));
    expect(loadQueueMap(dir)).toEqual(ROWS);
  });

  it("writes through a temp file, leaving only the mapping behind", () => {
    saveQueueMap(ROWS, dir);
    saveQueueMap(ROWS, dir);
    expect(readdirSync(dir)).toEqual(["queue-map.json"]);
  });

  it("loads a corrupt file as an empty list", () => {
    writeFileSync(path.join(dir, "queue-map.json"), "{not json");
    expect(loadQueueMap(dir)).toEqual([]);
    writeFileSync(path.join(dir, "queue-map.json"), '{"a":1}');
    expect(loadQueueMap(dir)).toEqual([]);
  });
});
