import { describe, expect, it } from "vitest";
import type { Incident, Instance } from "@/lib/types";
import { incidentMatches, ledgerMatches, readFilter, withFilter } from "./listFilters";

const row = (over: Partial<Instance>) => ({ agent: "Reyes, Amara - AH12345", team: "Billing", stage: "nudge", ...over }) as Instance;

describe("list filters", () => {
  it("round-trips through a URL", () => {
    const f = { q: " ah123 ", queues: ["Billing", "Claims & Appeals"], stage: "lead" as const };
    const url = withFilter("/api/export/ledger", f);
    expect(readFilter(new URL(url, "http://x").searchParams)).toEqual({ q: "ah123", queues: ["Billing", "Claims & Appeals"], stage: "lead" });
    expect(withFilter("/api/export/ledger", { q: "", queues: [] })).toBe("/api/export/ledger");
  });

  it("ignores an unknown stage", () => {
    expect(readFilter(new URLSearchParams("stage=everything")).stage).toBe("");
  });

  it("matches ledger rows by name or ID, queue and stage", () => {
    const match = ledgerMatches({ q: "ah123", queues: ["Billing"], stage: "nudge" });
    expect(match(row({}))).toBe(true);
    expect(match(row({ team: "Claims" }))).toBe(false);
    expect(match(row({ stage: "ops" }))).toBe(false);
    expect(match(row({ agent: "Lim, Joshua - AH99999" }))).toBe(false);
  });

  it("matches incidents by name and queue", () => {
    const inc = { agent: "Reyes, Amara - AH12345", team: "Billing" } as Incident;
    expect(incidentMatches({ q: "reyes", queues: [] })(inc)).toBe(true);
    expect(incidentMatches({ q: "", queues: ["Claims"] })(inc)).toBe(false);
  });
});
