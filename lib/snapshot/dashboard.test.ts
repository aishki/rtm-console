import { describe, expect, it } from "vitest";
import type { RosterAgent, Team } from "@/lib/types";
import { createEngine } from "@/lib/engine/engine";
import { dashboardHtml, snapshotData, snapshotFileName } from "./dashboard";

const ORG: Team[] = [
  { team: "Team Alpha", tl: "Rina Velasco", mgr: "Ava Santiago", lob: "PAP Intake" },
  { team: "Team Delta", tl: "Jon Rivera", mgr: "Leo Fernandez", lob: "Member Care" },
];
const ROSTER: RosterAgent[] = [
  { name: "Amara Reyes", team: "Team Alpha", state: "avail" },
  { name: "Joshua Lim", team: "Team Alpha", state: "avail" },
  { name: "Miguel Cruz", team: "Team Delta", state: "avail" },
];
const NOW = new Date("2026-10-07T18:05:00Z"); // 14:05 in New York, the floor's time

/** A floor where Amara ran over ACW three times (an incident) and Miguel once. */
function floor() {
  const e = createEngine({ toast: () => {}, nudge: () => {} });
  e.reset({ t: 8 * 3600 });
  e.ingest.onRoster({ org: ORG, agents: ROSTER });
  const run = (seconds: number) => { for (let i = 0; i < seconds; i++) { e.ingest.onHeartbeat(); e.tick(); } };
  const overAcw = (agent: string) => { e.ingest.onAgentState({ agent, state: "acw" }); run(121); e.ingest.onAgentState({ agent, state: "avail" }); run(1); };
  for (let i = 0; i < 3; i++) overAcw("Amara Reyes");
  overAcw("Miguel Cruz");
  return e.S;
}

describe("dashboard snapshot", () => {
  it("holds everything an admin's dashboard shows", () => {
    const d = snapshotData(floor(), { role: "admin", who: null }, "gencloud", NOW);
    expect(d).toMatchObject({ viewer: "WFM Admin", role: "Admin (WFM)", source: "Live Genesys", notice: "", canExport: true, takenAt: NOW.toISOString() });
    expect(d.teams).toEqual([
      { team: "Team Alpha", tl: "Rina Velasco", mgr: "Ava Santiago", agents: 2 },
      { team: "Team Delta", tl: "Jon Rivera", mgr: "Leo Fernandez", agents: 1 },
    ]);
    expect(d.ledger.filter(r => r.agent === "Amara Reyes")).toHaveLength(3);
    expect(d.ledger.filter(r => r.agent === "Miguel Cruz")).toHaveLength(1);
    expect(d.incidents.map(i => [i.agent, i.rule, i.instances, i.status])).toEqual([["Amara Reyes", "Extended ACW", 3, "Open"]]);
  });

  it("is cut to the viewer's span and follows their export permission", () => {
    const d = snapshotData(floor(), { role: "tl", who: "Jon Rivera" }, "gencloud", NOW);
    expect(d.teams.map(t => t.team)).toEqual(["Team Delta"]);
    expect(d.ledger.map(r => r.agent)).toEqual(["Miguel Cruz"]);
    expect(d.incidents).toEqual([]);
    expect(d.canExport).toBe(false);
    expect(dashboardHtml(d)).not.toContain("Amara Reyes");
  });

  it("says when the activity is not real", () => {
    const S = floor(), admin = { role: "admin", who: null } as const;
    expect(snapshotData(S, admin, "sim", NOW)).toMatchObject({ source: "Simulation", notice: expect.stringContaining("invented") });
    expect(snapshotData(S, admin, "csv", NOW)).toMatchObject({ source: "Data replay", notice: expect.stringContaining("imported file") });
  });

  it("is one file with no outside requests and no way back to the console", () => {
    const html = dashboardHtml(snapshotData(floor(), { role: "admin", who: null }, "gencloud", NOW));
    expect(html).not.toMatch(/<link|<img|<iframe|https?:/);
    expect(html).not.toMatch(/fetch\(|XMLHttpRequest|\/api\//);
    const script = html.match(/<script>([\s\S]*)<\/script>/)![1];
    expect(() => new Function(script)).not.toThrow();
  });

  it("embeds names without letting them break out of the data block", () => {
    const S = floor();
    S.ledger[0].agent = "</script><img src=x onerror=alert(1)>";
    const html = dashboardHtml(snapshotData(S, { role: "admin", who: null }, "gencloud", NOW));
    expect(html).not.toContain("</script><img");
    const json = html.match(/<script id="rtm-data" type="application\/json">([\s\S]*?)<\/script>/)![1];
    expect(JSON.parse(json).ledger[0].agent).toBe("</script><img src=x onerror=alert(1)>");
  });

  it("names the file after the local date and time", () => {
    expect(snapshotFileName(NOW)).toBe("RTM_dashboard_snapshot_2026-10-07_1405.html");
  });
});
