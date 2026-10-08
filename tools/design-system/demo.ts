import { defaultRules } from "@/lib/engine/rules";
import { peopleDirectory } from "@/lib/engine/scope";
import type { Agent, Incident, Instance, NudgeEvent, Team } from "@/lib/types";
import { useConsole } from "@/lib/client/store";

// Sample floor for the previews. Every name, ID and number here is invented.
const org: Team[] = [
  { team: "Member Services A", tl: "Sample, Tessa", mgr: "Sample, Morgan", lob: "Member Services" },
  { team: "Provider Support B", tl: "Sample, Ravi", mgr: "Sample, Morgan", lob: "Provider Support" },
];
const a = (id: number, name: string, team: string, state: Agent["state"], stTime: number, more: Partial<Agent> = {}): Agent => ({
  id, name, team, state, stTime, aht: 312, calls: 14, shortCalls: 0, transfers: 1, onHold: false, holdTime: 0, adh: 96, strikes: {}, fired: {}, ...more,
});
const A = "Member Services A", B = "Provider Support B";
const agents: Agent[] = [
  a(1, "Example, Alex - AH10001", A, "oncall", 244, { aht: 287, calls: 18 }),
  a(2, "Example, Bea - AH10002", A, "acw", 191, { strikes: { acw: 2 }, adh: 91 }),
  a(3, "Example, Carlo - AH10003", A, "oncall", 512, { onHold: true, holdTime: 148, strikes: { hold: 1 } }),
  a(4, "Example, Dana - AH10004", A, "avail", 37),
  a(5, "Example, Eli - AH10005", A, "off", 742, { strikes: { offl: 3 }, adh: 84, calls: 9 }),
  a(6, "Example, Fran - AH10006", A, "auxb", 410),
  a(7, "Example, Gio - AH10007", B, "outb", 96, { transfers: 4 }),
  a(8, "Example, Hana - AH10008", B, "avail", 12, { shortCalls: 2 }),
  a(9, "Example, Ivan - AH10009", B, "auxp", 128),
  a(10, "Example, Jo - AH10010", B, "oncall", 71),
];
const inst = (n: number, t: number, agent: string, rule: string, ruleId: Instance["ruleId"], val: string, more: Partial<Instance> = {}): Instance => ({
  n, t, agent, isFloor: false, team: A, rule, ruleId, val, stage: "nudge", sev: "warn", status: "open", ackT: null, strikes: 1, inc: "", cmt: null, cond: "", rev: n, ...more,
});
const ledger: Instance[] = [
  inst(14, 36420, "Example, Eli - AH10005", "Prolonged offline", "offl", "12:22 offline", { stage: "ops", sev: "esc", strikes: 3, inc: "IR-0003" }),
  inst(13, 36310, "Example, Bea - AH10002", "Extended ACW", "acw", "3:11 in ACW", { stage: "lead", strikes: 2, cmt: "Member asked for a callback, writing it up." }),
  inst(12, 36185, "Example, Carlo - AH10003", "Long hold", "hold", "2:28 on hold"),
  inst(11, 35990, "Example, Gio - AH10007", "Outbound call", "outb", "10:04 outbound", { team: B, stage: "lead", status: "acked", ackT: 36032 }),
];
const incidents: Incident[] = [
  { inc: "IR-0003", t: 36420, agent: "Example, Eli - AH10005", team: A, rule: "Prolonged offline", ruleId: "offl", instances: 3, status: "Open", disposition: "", closedT: null },
  { inc: "IR-0002", t: 31200, agent: "Example, Gio - AH10007", team: B, rule: "Outbound call", ruleId: "outb", instances: 3, status: "Closed", disposition: "Coached & documented", closedT: 33900 },
];
const nudge: NudgeEvent = { n: 12, agent: "Example, Carlo - AH10003", team: A, first: "Carlo", body: "Your member has been on hold for over 2 minutes. If you need more time, check back in with them or tell your TL what's holding things up." };

/** Sample data, and `use()` to load it into the stand-in store that Navbar, ContextBar, the toasts and the nudge read. */
export const demo = {
  org, agents, ledger, incidents, nudge, rules: defaultRules(),
  use(patch: Record<string, unknown> = {}): void {
    useConsole.setState({
      status: "ready", view: { role: "mgr", who: "Sample, Morgan" }, org, people: peopleDirectory({ org, agents }), t: 36500, mode: "live", feed: "sim",
      realNames: false, canSwitchFeed: false, staleFor: 0, replay: null, rules: defaultRules(), agents, incidents, ledger, toasts: [], nudge: null, ...patch,
    });
  },
};
