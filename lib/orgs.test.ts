import { describe, expect, it } from "vitest";
import { queueNamesFor } from "./orgs";

describe("an org's queues", () => {
  const rows = [
    { tower: "T", subTower: "S", lob: "L", queue: "COM_1", org: "Anthem Commercial" },
    { tower: "T", subTower: "S", lob: "L", queue: "GBD_1", org: "Anthem GBD" },
    { tower: "T", subTower: "S", lob: "L", queue: "GBD_2", org: "anthem-gbd" },
    { tower: "T", subTower: "S", lob: "L", queue: "ANY_1" },
  ];

  it("are the queue map rows its Org column names, ignoring case and punctuation, plus rows with no Org", () => {
    expect(queueNamesFor(rows, "gbd")).toEqual(["GBD_1", "GBD_2", "ANY_1"]);
    expect(queueNamesFor(rows, "commercial")).toEqual(["COM_1", "ANY_1"]);
    expect(queueNamesFor(rows, "specialty")).toEqual(["ANY_1"]);
  });
});
