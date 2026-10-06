import { describe, it, expect } from "vitest";
import { mapGenesysState } from "./state";

describe("mapGenesysState", () => {
  it("INTERACTING -> oncall", () => expect(mapGenesysState("AVAILABLE","INTERACTING")).toBe("oncall"));
  it("IDLE+AVAILABLE -> avail", () => expect(mapGenesysState("AVAILABLE","IDLE")).toBe("avail"));
  it("BREAK -> auxb", () => expect(mapGenesysState("BREAK","IDLE")).toBe("auxb"));
  it("BUSY -> auxp", () => expect(mapGenesysState("BUSY","IDLE")).toBe("auxp"));
  it("OFF_QUEUE -> off", () => expect(mapGenesysState("AVAILABLE","OFF_QUEUE")).toBe("off"));
  it("OFFLINE -> off", () => expect(mapGenesysState("OFFLINE", undefined)).toBe("off"));
  it("unknown presence -> auxp", () => expect(mapGenesysState("MEETING","IDLE")).toBe("auxp"));
});
