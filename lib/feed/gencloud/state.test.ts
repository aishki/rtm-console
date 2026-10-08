import { describe, it, expect } from "vitest";
import { mapGenesysState } from "./state";

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
