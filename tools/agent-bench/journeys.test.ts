// SPDX-License-Identifier: Apache-2.0
// The checks of the journeys with a model (journeys.ts): no model runs here.
import { describe, expect, test } from "bun:test";
import { journeySummary } from "./journeys";
import { missingParts, START_PROMPTS } from "./journeyStart";

const museum = START_PROMPTS.find((prompt) => prompt.id === "museum");

/** A scene document with entities of these names. */
function scene(names: readonly string[]): object {
  return { entities: Object.fromEntries(names.map((name, index) => [`e${String(index)}`, { name }])) };
}

describe("the check of the start journey", () => {
  test("there are five prompts, and the first one is the museum example", () => {
    expect(START_PROMPTS).toHaveLength(5);
    expect(museum?.words).toBe("a small museum room with three statues on plinths");
  });

  test("a scene passes when each part is there enough times, by name or ID", () => {
    if (museum === undefined) throw new Error("no museum prompt");
    const full = scene(["Statue 1", "Statue 2", "Bust", "Plinth A", "Plinth B", "Pedestal", "Floor"]);
    expect(missingParts(full, museum)).toEqual([]);
    expect(missingParts({ entities: { "statue-1": {}, "statue-2": {}, "statue-3": {} } }, museum)).toEqual([
      "plinth|pedestal|base: 0 of 3",
    ]);
    expect(missingParts(scene(["Floor", "Back wall"]), museum)).toHaveLength(2);
  });

  test("the summary counts the passed prompts and gives the result of the plugin journey", () => {
    const run = {
      id: "museum",
      passed: true,
      detail: "each part is there",
      project: "museum",
      waiting: "6 changes wait",
    };
    const summary = journeySummary([{ ...run, costUsd: 0.5, durationMs: 60_000 }], {
      passed: false,
      detail: "the system is still the stub of the wizard",
      reviews: 2,
      costUsd: 1,
      durationMs: 1000,
    });
    expect(summary).toContain("Start from a sentence: 1 of 1");
    expect(summary).toContain("| museum | yes | 6 changes wait | 60 | 0.50 | each part is there |");
    expect(summary).toContain("A plugin: failed");
  });
});
