import { describe, expect, it } from "vitest";
import { createEngine } from "@/lib/engine/engine";
import { CsvReplayFeed } from "@/lib/feed/CsvReplayFeed";
import { type Sheet, buildFloorImport, wallClock } from "./floor";
import { buildTemplate, readSheets } from "./xlsx";

const at = (h: number, m = 0, s = 0) => new Date(Date.UTC(2026, 9, 1, h, m, s));

function sheets(over: Record<string, Sheet> = {}): Record<string, Sheet> {
  return {
    Roster: [
      ["Agent Name", "Team", "Team Lead", "Manager", "LOB", "Adherence %"],
      ["Amara Reyes", "Team Alpha", "Rina Velasco", "Ava Santiago", "PAP Intake", 97],
      ["Joshua Lim", "Team Alpha", "Rina Velasco", "Ava Santiago", "PAP Intake", null],
      ["Katrina Uy", "Team Bravo", "Marco Tan", "Ava Santiago", null, 0.93],
    ],
    "Agent Status": [
      ["Agent Name", "Status", "Start Time", "Transferred"],
      ["Amara Reyes", "Available", at(8), null],
      ["Amara Reyes", "On Call", at(8, 5), null],
      ["Amara Reyes", "ACW", at(8, 10), "Y"],
      ["Joshua Lim", "On Queue", "2026-10-01 08:01:00", null],
      ["Joshua Lim", "Meeting", "2026-10-01 08:20:00", null],
    ],
    ...over,
  };
}
const ok = (s: Record<string, Sheet>) => { const r = buildFloorImport(s); if (!r.ok) throw new Error(r.errors.join(" | ")); return r; };
const errorsOf = (s: Record<string, Sheet>) => { const r = buildFloorImport(s); return r.ok ? [] : r.errors; };

describe("floor data import", () => {
  it("builds the org, roster and a time-ordered status timeline", () => {
    const { data, summary } = ok(sheets());
    expect(data.org).toEqual([
      { team: "Team Alpha", tl: "Rina Velasco", mgr: "Ava Santiago", lob: "PAP Intake" },
      { team: "Team Bravo", tl: "Marco Tan", mgr: "Ava Santiago", lob: "Team Bravo" },
    ]);
    expect(data.roster.map(a => [a.name, a.team, a.adh])).toEqual([["Amara Reyes", "Team Alpha", 97], ["Joshua Lim", "Team Alpha", 96], ["Katrina Uy", "Team Bravo", 93]]);
    expect(data.events.map(e => [e.agent.split(" ")[0], e.state, e.t])).toEqual([
      ["Amara", "avail", 28800], ["Joshua", "oncall", 28860], ["Amara", "oncall", 29100], ["Amara", "acw", 29400], ["Joshua", "auxp", 30000],
    ]);
    expect(data.events[3].transferred).toBe(true);
    expect(summary).toMatchObject({ agents: 3, teams: 2, events: 5, holds: 0, queueIntervals: 0, startT: 28800, endT: 30000 });
  });

  it("warns about guessed statuses, silent agents and missing queue data", () => {
    const { warnings } = ok(sheets());
    expect(warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('Status "Meeting" is not a console state; treated as Aux Personal'),
      expect.stringContaining("1 agent(s) have no status rows and stay Offline: Katrina Uy"),
      expect.stringContaining("No queue intervals"),
    ]));
  });

  it("reads time cells in every supported form", () => {
    expect(wallClock(at(8, 30))).toBe(Date.UTC(2026, 9, 1, 8, 30) / 1000);
    expect(wallClock("2026-10-01 08:30:00")).toBe(Date.UTC(2026, 9, 1, 8, 30) / 1000);
    expect(wallClock("2026-10-01T08:30:00")).toBe(Date.UTC(2026, 9, 1, 8, 30) / 1000);
    expect(wallClock(46296.354166666664)).toBe(Date.UTC(2026, 9, 1, 8, 30) / 1000);
    expect(wallClock("08:30:15")).toBe(8 * 3600 + 30 * 60 + 15);
    expect(wallClock("1:05 PM")).toBe(13 * 3600 + 5 * 60);
    expect(wallClock("soon")).toBeNaN();
    expect(wallClock(null)).toBeNaN();
  });

  it("reads holds and queue intervals, accepting Genesys-style fractions", () => {
    const { data, summary, warnings } = ok(sheets({
      Holds: [["Agent Name", "Hold Start", "Hold End"], ["Amara Reyes", at(8, 6), at(8, 9)], ["Nobody", at(8, 6), at(8, 7)]],
      "Queue Intervals": [["Interval Start", "Service Level %", "ASA", "Abandon %"], [at(8), 0.95, 7.8, 0.005], [at(8, 30), 0.72, 64.2, 0.071]],
    }));
    expect(data.holds).toEqual([{ agent: "Amara Reyes", t: 29160, on: true }, { agent: "Amara Reyes", t: 29340, on: false }]);
    expect(data.queue).toEqual([
      { t: 28800, queue: { cq: 0, sl: 95, asa: 8, ab: 0.5 } },
      { t: 30600, queue: { cq: 0, sl: 72, asa: 64, ab: expect.closeTo(7.1, 5) } },
    ]);
    expect(summary).toMatchObject({ holds: 1, queueIntervals: 2 });
    expect(warnings.join(" ")).toContain("Holds: skipped rows 3");
    expect(warnings.join(" ")).toContain('no "Calls Waiting" values');
  });

  it("reports every problem in the workbook at once", () => {
    expect(errorsOf({})).toEqual(['Sheet "Roster" is missing.', 'Sheet "Agent Status" is missing.']);
    expect(errorsOf(sheets({ Roster: [["Agent Name", "Team"], ["A", "T"]] }))).toEqual(expect.arrayContaining([
      'Sheet "Roster" is missing the "Team Lead" column.', 'Sheet "Roster" is missing the "Manager" column.',
    ]));
    const errs = errorsOf(sheets({
      Roster: [
        ["Agent Name", "Team", "Team Lead", "Manager"],
        ["Amara Reyes", "Team Alpha", "Rina Velasco", "Ava Santiago"],
        ["Amara Reyes", "Team Alpha", "Rina Velasco", "Ava Santiago"],
        ["Joshua Lim", "Team Alpha", "Someone Else", "Ava Santiago"],
        ["No Team", null, null, null],
      ],
      "Agent Status": [
        ["Agent Name", "Status", "Start Time"],
        ["Amara Reyes", "Available", at(8)],
        ["Amara Reyes", "On Call", "whenever"],
        ["Ghost Agent", "Available", at(8)],
      ],
    }));
    expect(errs).toEqual([
      "Roster: rows 5 need an agent name, team, team lead and manager.",
      "Roster: agent names must be unique. Repeated: Amara Reyes.",
      "Roster: a team has one team lead and one manager. Conflicting rows for: Team Alpha.",
      "Agent Status: rows 3 have a start time that could not be read. Use a date and time, e.g. 2026-10-01 08:00:00.",
      "Agent Status: these agents are not in the Roster sheet: Ghost Agent.",
    ]);
  });

  it("rejects a file that spans more than one day", () => {
    const s = sheets();
    s["Agent Status"].push(["Amara Reyes", "Offline", new Date(Date.UTC(2026, 9, 3, 8))]);
    expect(errorsOf(s)).toEqual(["The file spans more than one day. Import one shift at a time."]);
  });
});

describe("the downloadable template", () => {
  it("round-trips through the importer and runs through the engine", async () => {
    const res = buildFloorImport(await readSheets(await buildTemplate()));
    if (!res.ok) throw new Error(res.errors.join(" | "));
    expect(res.summary).toMatchObject({ agents: 8, teams: 2, queueIntervals: 18 });
    expect(res.summary.holds).toBeGreaterThan(0);
    expect(res.warnings).toEqual([]);

    const { events, ...extras } = res.data;
    const feed = new CsvReplayFeed(events, extras);
    const engine = createEngine({}, { deriveAdh: true });
    engine.reset({ t: feed.startT, mode: "replay", replay: feed.meta });
    feed.subscribe(engine.ingest);
    while (!engine.S.replay!.done) { feed.tick(engine.S.t + 1); engine.tick(); }

    const S = engine.S;
    expect(S.org.map(t => t.tl)).toEqual(["Rina Velasco", "Marco Tan"]);
    expect(S.agents).toHaveLength(8);
    const fired = new Set(S.ledger.map(r => r.ruleId));
    // The sample day is built to show agent rules, a hold rule and the queue rules.
    for (const id of ["acw", "short", "hold", "ovbrk", "cq", "sl", "aband"] as const) expect(fired, id).toContain(id);
    expect(S.incidents.length).toBeGreaterThan(0);
    expect(S.ledger.some(r => r.isFloor)).toBe(true);
    expect(S.agents.some(a => a.transfers > 0)).toBe(true);
  });
});
