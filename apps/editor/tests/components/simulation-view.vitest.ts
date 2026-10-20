// SPDX-License-Identifier: Apache-2.0
// The view of a simulation state: a record of records is a table (the cars of the traffic plugin), and the other fields
// are values.
import { describe, expect, it } from "vitest";
import { stateView } from "../../src/scene/simulation/simulationView";

describe("the view of a simulation state", () => {
  it("makes a table of the cars and values of the other fields", () => {
    const view = stateView({
      t: 12000,
      signal: "red",
      cars: { "car-b": { lane: "east", s: 12.345678, v: 0 }, "car-a": { lane: "west", s: 3, v: 4.5, committed: true } },
      config: { motion: { carSpeed: 8 } },
    });
    expect(view.tables).toEqual([
      {
        name: "cars",
        columns: ["committed", "lane", "s", "v"],
        rows: [
          { id: "car-a", cells: [true, "west", 3, 4.5] },
          { id: "car-b", cells: [null, "east", 12.3457, 0] },
        ],
      },
      // A record of records at any depth one is a table too (the motion part of the config).
      { name: "config", columns: ["carSpeed"], rows: [{ id: "motion", cells: [8] }] },
    ]);
    expect(view.values).toEqual([
      { name: "signal", value: "red" },
      { name: "t", value: "12000" },
    ]);
    expect(stateView(5)).toEqual({ tables: [], values: [{ name: "", value: "5" }] });
  });
});
