import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEngine } from "@/lib/engine/engine";
import type { Team, View } from "@/lib/types";
import type { Runtime } from "./runtime";
import { queueMapRev, saveQueueMap } from "./queueMapStore";
import { type Since, tickMsg } from "./snapshot";

const ORG: Team[] = [
  { team: "Team Alpha", tl: "Rina Velasco", mgr: "Ava Santiago", lob: "PAP Intake" },
  { team: "Team Bravo", tl: "Marco Tan", mgr: "Ava Santiago", lob: "PAP Intake" },
];
const AGENTS = [
  { name: "Amara Reyes", team: "Team Alpha", state: "avail" as const },
  { name: "Joshua Lim", team: "Team Alpha", state: "avail" as const },
  { name: "Bea Santos", team: "Team Bravo", state: "avail" as const },
];
const BATCH = { toasts: [], nudges: [] };
const ADMIN: View = { role: "admin", who: null };

function setup() {
  const engine = createEngine({});
  engine.reset({ t: 8 * 3600 });
  engine.ingest.onRoster({ org: ORG, agents: AGENTS });
  const rt = { engine } as unknown as Runtime;
  const now = (): Since => ({ rev: engine.S.rev, rosterRev: engine.S.rosterRev, mapRev: queueMapRev() });
  return { engine, rt, now };
}

describe("tickMsg queue data", () => {
  it("sends membership and the mapping on the first snapshot", () => {
    const { rt, engine } = setup();
    const m = tickMsg(rt, ADMIN, null, BATCH);
    expect(m.members).toEqual({ "Team Alpha": [0, 1], "Team Bravo": [2] });
    expect(Array.isArray(m.queueMap)).toBe(true);
    expect(m.queues).toBe(engine.S.queues);
  });

  it("leaves them out while nothing changed", () => {
    const { rt, now } = setup();
    const m = tickMsg(rt, ADMIN, now(), BATCH);
    expect(m.members).toBeUndefined();
    expect(m.queueMap).toBeUndefined();
    expect(m.queues).toBeDefined();
  });

  it("resends membership after the roster reloads", () => {
    const { rt, engine, now } = setup();
    const since = now();
    engine.ingest.onRoster({ org: ORG, agents: AGENTS });
    const m = tickMsg(rt, ADMIN, since, BATCH);
    expect(m.members).toBeDefined();
    expect(m.queueMap).toBeUndefined();
  });

  it("resends the mapping after an upload", () => {
    const { rt, now } = setup();
    const since = now();
    // Saving to a scratch dir keeps the real mapping untouched; the rev still moves, which is what the stream watches.
    saveQueueMap([{ tower: "Voice", subTower: "Billing", lob: "Cards", queue: "Team Alpha" }], mkdtempSync(path.join(tmpdir(), "snap-")));
    expect(tickMsg(rt, ADMIN, since, BATCH).queueMap).toBeDefined();
  });

  it("scopes membership to the viewer's agents", () => {
    const { rt } = setup();
    const m = tickMsg(rt, { role: "tl", who: "Rina Velasco" }, null, BATCH);
    expect(m.members).toEqual({ "Team Alpha": [0, 1], "Team Bravo": [] });
    const agent = tickMsg(rt, { role: "agent", who: "Bea Santos" }, null, BATCH);
    expect(agent.members).toEqual({ "Team Alpha": [], "Team Bravo": [2] });
  });
});
