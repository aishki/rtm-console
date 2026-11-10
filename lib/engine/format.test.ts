import { describe, expect, it } from "vitest";
import { agentMetrics, causeSummary } from "./format";
import { AGENT_TESTS, myTargets } from "./rules";

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

describe("N/A for numbers nothing has supplied", () => {
  const base = { state: "avail" as const, aht: null, adh: null, calls: 2, transfers: 0, shortCalls: 0 };
  it("shows N/A for a missing AHT or adherence, and a real 0 as 0", () => {
    expect(agentMetrics(base)).toMatchObject({ aht: "N/A", adh: "N/A", calls: "2" });
    expect(agentMetrics({ ...base, aht: 0, adh: 0 })).toMatchObject({ aht: "0s", adh: "0%" });
  });
  it("an Offline agent with no calls today shows N/A throughout; one who worked keeps their numbers", () => {
    expect(agentMetrics({ ...base, state: "off", calls: 0, aht: 300, adh: 95 })).toEqual({ aht: "N/A", adh: "N/A", calls: "N/A", transfers: "N/A", short: "N/A" });
    expect(agentMetrics({ ...base, state: "off", aht: 300 })).toMatchObject({ aht: "300s", calls: "2" });
  });
  it("the adherence rule never fires without adherence, and My targets says so", () => {
    const a = { state: "avail", adh: null } as unknown as Parameters<NonNullable<typeof AGENT_TESTS.adh>>[0];
    expect(AGENT_TESTS.adh!(a, 90)).toBe(false);
    const rules = [{ id: "adh", name: "Adherence", type: "agent", thr: 90, on: true, sev: "warn", route: "lead", overrides: [] }] as unknown as Parameters<typeof myTargets>[1];
    expect(myTargets({ ...a, place: undefined } as never, rules)[0]).toMatchObject({ now: "N/A", stat: "No data" });
  });
});
