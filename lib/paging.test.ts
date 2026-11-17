import { describe, expect, it } from "vitest";
import { pageLabel, pageSlice } from "./paging";

describe("pageSlice", () => {
  it("cuts a list into pages", () => {
    expect(pageSlice(120, 1, 50)).toEqual({ page: 1, pages: 3, from: 0, to: 50 });
    expect(pageSlice(120, 3, 50)).toEqual({ page: 3, pages: 3, from: 100, to: 120 });
  });
  it("clamps a page past the end to the last one", () => {
    expect(pageSlice(120, 9, 50).page).toBe(3);
    expect(pageSlice(30, 2, 50)).toEqual({ page: 1, pages: 1, from: 0, to: 30 });
  });
  it("has one empty page for an empty list", () => {
    expect(pageSlice(0, 4, 25)).toEqual({ page: 1, pages: 1, from: 0, to: 0 });
  });
});

describe("pageLabel", () => {
  it("describes the rows shown", () => {
    expect(pageLabel(1234, pageSlice(1234, 2, 50))).toBe("51–100 of 1,234");
    expect(pageLabel(0, pageSlice(0, 1, 50))).toBe("0 of 0");
  });
});
