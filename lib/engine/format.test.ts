import { describe, expect, it } from "vitest";
import { causeSummary } from "./format";

const I = (rule: string, instances: number, status = "Open") => ({ rule, instances, status });

describe("causeSummary", () => {
  it("shows a single incident as before", () => {
    expect(causeSummary([I("Extended ACW", 3)])).toBe("Extended ACW ×3");
    expect(causeSummary([I("Extended ACW", 3, "Closed")])).toBe("Extended ACW ×3 (closed)");
  });

  it("folds repeats of one rule into a count, newest rule first", () => {
    const list = [I("Prolonged offline", 2158), ...Array.from({ length: 2154 }, (_, k) => I("Prolonged offline", 2157 - k)), I("Short call", 3), I("Prolonged offline", 3, "Closed")];
    expect(causeSummary(list)).toBe("Prolonged offline: 2,156 IRs, latest ×2158 (2,155 open) · Short call ×3");
  });

  it("marks a rule whose incidents are all closed", () => {
    expect(causeSummary([I("Long hold", 4, "Closed"), I("Long hold", 3, "Closed")])).toBe("Long hold: 2 IRs, latest ×4 (closed)");
  });
});
