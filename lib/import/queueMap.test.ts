import { describe, expect, it } from "vitest";
import { mergeQueueMap, parseQueueMap, type QueueMapRow } from "@/lib/import/queueMap";

const SHEET = "Queue-to-LOB mapping";

describe("parseQueueMap", () => {
  it("reads both WFM layouts by header name", () => {
    const provider = parseQueueMap({ [SHEET]: [
      ["Tower", "Sub Tower", "LOB", "Queues", "Region", "Org"],
      [" Provider Services ", "Claims", "Small Group", "Q_ONE", "East", "Org A"],
    ] });
    const ms = parseQueueMap({ [SHEET.toUpperCase()]: [
      ["Region", "Org", "Queues", "Tower", "Sub -Tower", "LOB"],
      ["East", "Org A", "Q_ONE", "Provider Services", "Claims", "Small Group"],
    ] });
    const row = { tower: "Provider Services", subTower: "Claims", lob: "Small Group", queue: "Q_ONE", region: "East", org: "Org A" };
    expect(provider).toEqual({ ok: true, rows: [row], skipped: [], duplicates: [] });
    expect(ms).toEqual(provider);
  });

  it("refuses a workbook without the mapping sheet", () =>
    expect(parseQueueMap({ PIVOT: [["x"]] })).toEqual({ ok: false, errors: ["No sheet named \"Queue-to-LOB mapping\"."] }));

  it("refuses a sheet missing a required column", () =>
    expect(parseQueueMap({ [SHEET]: [["Tower", "LOB", "Queues"]] })).toEqual({ ok: false, errors: ["Missing column: Sub-tower."] }));

  it("skips and reports a row with a blank required cell, ignoring empty rows", () => {
    const r = parseQueueMap({ [SHEET]: [
      ["Tower", "Sub Tower", "LOB", "Queues"],
      ["T", "S", "L", "A"],
      ["T", "S", "  ", "B"],
      [null, "", null, null],
      ["T", "S", "L", "C"],
    ] });
    expect(r).toEqual({
      ok: true,
      rows: [{ tower: "T", subTower: "S", lob: "L", queue: "A" }, { tower: "T", subTower: "S", lob: "L", queue: "C" }],
      skipped: [{ row: 3, reason: "Missing LOB" }],
      duplicates: [],
    });
  });

  it("keeps the first of a duplicated queue and reports it", () => {
    const r = parseQueueMap({ [SHEET]: [
      ["Tower", "Sub Tower", "LOB", "Queues"],
      ["Member Services", "Benefits", "Small Group", "CSBD_LGO_SG_CA_Bnfts_Mem"],
      ["Member Services", "Benefits", "CA Traditional", " csbd_lgo_sg_ca_bnfts_mem "],
    ] });
    expect(r).toEqual({
      ok: true,
      rows: [{ tower: "Member Services", subTower: "Benefits", lob: "Small Group", queue: "CSBD_LGO_SG_CA_Bnfts_Mem" }],
      skipped: [],
      duplicates: [{ queue: "csbd_lgo_sg_ca_bnfts_mem", kept: "Small Group", dropped: "CA Traditional" }],
    });
  });
});

describe("parseQueueMap duplicates", () => {
  it("keeps the first of a repeated queue silently when the LOB is the same", () => {
    const r = parseQueueMap({ [SHEET]: [
      ["Tower", "Sub Tower", "LOB", "Queues"],
      ["Member Services", "Benefits", "Small Group", "Q1"],
      ["Member Services", "Other", "Small Group", "q1"],
    ] });
    expect(r).toEqual({ ok: true, rows: [{ tower: "Member Services", subTower: "Benefits", lob: "Small Group", queue: "Q1" }], skipped: [], duplicates: [] });
  });
});

describe("mergeQueueMap", () => {
  it("replaces only the towers in the upload", () => {
    const p = (tower: string, queue: string): QueueMapRow => ({ tower, subTower: "s", lob: "l", queue });
    expect(mergeQueueMap([p("Provider Services", "A"), p("Member Services", "B")], [p("Member Services", "C")]))
      .toEqual([p("Provider Services", "A"), p("Member Services", "C")]);
  });
});
