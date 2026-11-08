import { describe, expect, it } from "vitest";
import type { AgentLeads, Incident, Instance } from "@/lib/types";
import { NO_LEADER } from "./format";
import { agentQueues, leadRows } from "./leadRows";

// Invented agents: two under one Team Lead, one under another, one with no supervisor.
const LEADS: Record<string, AgentLeads> = {
  a1: { tl: "Lead, Tess", mgr: "Lead, Morgan" },
  a2: { tl: "Lead, Tess", mgr: "Lead, Morgan" },
  a3: { tl: "Lead, Ravi", mgr: null },
};
const agents = ["a1", "a2", "a3", "a4"].map(uid => ({ uid }));
const QUEUES: Record<string, string[]> = { a1: ["Q Billing", "Q Claims"], a2: ["Q Claims"], a3: ["Q Claims"], a4: [] };
const queuesOf = (uid: string) => QUEUES[uid];
type Row = Pick<Instance, "agentId" | "isFloor" | "stage" | "rule">;
const C = (agentId: string | null, stage: Row["stage"], rule = "Extended ACW"): Row => ({ agentId, isFloor: !agentId, stage, rule });

describe("leadRows", () => {
  it("groups agents by Team Lead, with call-outs, open incidents and the top cause", () => {
    const ledger = [C("a1", "nudge"), C("a1", "lead"), C("a2", "nudge", "Long hold"), C("a3", "ops"), C("a4", "nudge"), C(null, "lead")];
    const incidents: Pick<Incident, "agentId" | "status">[] = [{ agentId: "a1", status: "Open" }, { agentId: "a2", status: "Closed" }];
    expect(leadRows(agents, uid => LEADS[uid], queuesOf, ledger, incidents)).toEqual([
      { tl: "Lead, Ravi", mgr: NO_LEADER, agents: 1, queues: ["Q Claims"], n: 0, l: 0, o: 1, ir: 0, top: "Extended ACW ×1" },
      { tl: "Lead, Tess", mgr: "Lead, Morgan", agents: 2, queues: ["Q Billing", "Q Claims"], n: 2, l: 1, o: 0, ir: 1, top: "Extended ACW ×2" },
      { tl: NO_LEADER, mgr: "—", agents: 1, queues: [], n: 1, l: 0, o: 0, ir: 0, top: "Extended ACW ×1" },
    ]);
  });

  it("counts only the picked queue's agents", () => {
    const ledger = [C("a1", "nudge"), C("a2", "lead")];
    const rows = leadRows(agents, uid => LEADS[uid], queuesOf, ledger, [{ agentId: "a2", status: "Open" }], "Q Billing");
    expect(rows).toEqual([{ tl: "Lead, Tess", mgr: "Lead, Morgan", agents: 1, queues: ["Q Billing", "Q Claims"], n: 1, l: 0, o: 0, ir: 0, top: "Extended ACW ×1" }]);
  });

  it("lists each agent's queues from their team and the queue membership", () => {
    const qs = agentQueues([{ id: 0, uid: "a1", team: "Q Claims" }, { id: 1, uid: "a2", team: "" }], { "Q Billing": [0, 1], "Q Claims": [0] });
    expect(Object.fromEntries(qs)).toEqual({ a1: ["Q Billing", "Q Claims"], a2: ["Q Billing"] });
  });

  it("shows no rows without agents", () => {
    expect(leadRows([], () => undefined, () => [], [C("a1", "nudge")], [])).toEqual([]);
  });
});
