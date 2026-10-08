import { describe, it, expect } from "vitest";
import { consoleState, mapGenesysState, stateSince } from "./state";

// Presence values as Genesys sends them ("On Queue", with a space), counted on the live tenant.
describe("mapGenesysState", () => {
  it("On Queue + IDLE (waiting for a call) -> avail", () => expect(mapGenesysState("On Queue", "IDLE")).toBe("avail"));
  it("On Queue before routing arrives -> avail", () => expect(mapGenesysState("On Queue", undefined)).toBe("avail"));
  it("routing IDLE before presence arrives -> avail (IDLE only exists on queue)", () => expect(mapGenesysState(undefined, "IDLE")).toBe("avail"));
  it("On Queue + NOT_RESPONDING -> auxp", () => expect(mapGenesysState("On Queue", "NOT_RESPONDING")).toBe("auxp"));
  it("INTERACTING -> oncall, whatever the presence", () => {
    expect(mapGenesysState("On Queue", "INTERACTING")).toBe("oncall");
    expect(mapGenesysState("Available", "INTERACTING")).toBe("oncall");
    expect(mapGenesysState("Busy", "INTERACTING")).toBe("oncall");
  });
  it("COMMUNICATING (a non-ACD call) -> outb", () => expect(mapGenesysState("Busy", "COMMUNICATING")).toBe("outb"));
  it("Break and Meal -> auxb, although routing is OFF_QUEUE", () => {
    expect(mapGenesysState("Break", "OFF_QUEUE")).toBe("auxb");
    expect(mapGenesysState("Meal", "OFF_QUEUE")).toBe("auxb");
  });
  it("logged in but off queue -> auxp, not Offline", () => {
    for (const p of ["Available", "Busy", "Away", "Meeting", "Training", "Idle"]) expect(mapGenesysState(p, "OFF_QUEUE")).toBe("auxp");
  });
  it("Offline -> off", () => expect(mapGenesysState("Offline", "OFF_QUEUE")).toBe("off"));
  it("also accepts the upper-case form", () => {
    expect(mapGenesysState("ON_QUEUE", "IDLE")).toBe("avail");
    expect(mapGenesysState("BREAK", "OFF_QUEUE")).toBe("auxb");
  });
});

describe("stateSince", () => {
  const P = "2026-10-08T12:00:00.000Z", R = "2026-10-08T13:30:00.000Z";
  it("uses routing's start for states routing decides", () => {
    expect(stateSince("On Queue", "INTERACTING", P, R)).toBe(Date.parse(R));
    expect(stateSince("On Queue", "IDLE", P, R)).toBe(Date.parse(R));
    expect(stateSince("Busy", "COMMUNICATING", P, R)).toBe(Date.parse(R));
  });
  it("uses presence's change for Break, Aux and Offline", () => {
    expect(stateSince("Break", "OFF_QUEUE", P, R)).toBe(Date.parse(P));
    expect(stateSince("Away", "OFF_QUEUE", P, R)).toBe(Date.parse(P));
    expect(stateSince("Offline", "IDLE", P, R)).toBe(Date.parse(P));
  });
  it("falls back to the other timestamp, and gives undefined with neither", () => {
    expect(stateSince("On Queue", "IDLE", P, undefined)).toBe(Date.parse(P));
    expect(stateSince("Break", "OFF_QUEUE", undefined, R)).toBe(Date.parse(R));
    expect(stateSince("Break", "OFF_QUEUE", undefined, "not a date")).toBeUndefined();
  });
});

describe("consoleState", () => {
  it("is ACW while after-call work is pending and no call is connected, although routing says INTERACTING", () => {
    expect(consoleState("On Queue", "INTERACTING", { onCall: false, acwSince: 1 })).toBe("acw");
  });
  it("is On Call when another call is connected", () => {
    expect(consoleState("On Queue", "INTERACTING", { onCall: true, acwSince: 1 })).toBe("oncall");
  });
  it("leaves Offline and the no-call cases to presence and routing", () => {
    expect(consoleState("Offline", "OFF_QUEUE", { onCall: false, acwSince: 1 })).toBe("off");
    expect(consoleState("On Queue", "IDLE", { onCall: false, acwSince: null })).toBe("avail");
    expect(consoleState("On Queue", "IDLE")).toBe("avail");
  });
});
