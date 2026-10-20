// SPDX-License-Identifier: Apache-2.0
// `defineSimulation` makes the simulation face of a plugin. The evaluator replays its action keys, and the
// frame holds its `project` output. The state schema checks a state.
import { describe, expect, test } from "bun:test";
import { createEvaluator, defineSimulation, stateProblems, type SequenceDocument } from "../src/index";
import { registry } from "./helpers";
import { testScene } from "./sequenceKit";

interface Lamps {
  readonly on: readonly string[];
  readonly since: number;
}

const lamps = defineSimulation<Lamps, { readonly count: number; readonly onFor: number }>({
  id: "lamps",
  stateSchema: {
    safeParse(value) {
      const state = value as Partial<Lamps> | null;
      return Array.isArray(state?.on) && typeof state.since === "number"
        ? { success: true, data: state as Lamps }
        : { success: false, error: { issues: [{ path: ["on"], message: "not a list" }] } };
    },
  },
  initial: (params) => ({ on: Array.isArray(params) ? params.map(String) : [], since: 0 }),
  reduce(state, key) {
    const lamp = typeof key.args?.lamp === "string" ? key.args.lamp : "lamp";
    if (key.action === "lamps.on" && !state.on.includes(lamp)) return { on: [...state.on, lamp].sort(), since: key.t };
    if (key.action === "lamps.off") return { on: state.on.filter((item) => item !== lamp), since: key.t };
    return state;
  },
  // A lamp burns out 4 s after the last change.
  settle: (state, t) =>
    state.on.length > 0 && t - state.since >= 4000 ? { on: [], since: state.since + 4000 } : state,
  project: (state, t) => ({ count: state.on.length, onFor: state.on.length > 0 ? t - state.since : 0 }),
});

const sequence: SequenceDocument = {
  format: "scenity.sequence/1",
  id: "evening",
  scene: "test",
  duration: 10000,
  initial: { lamps: ["porch"] },
  tracks: [
    {
      kind: "action",
      keys: [
        { t: 1000, action: "lamps.on", args: { lamp: "desk" } },
        { t: 2000, action: "lamps.off", args: { lamp: "porch" } },
      ],
    },
  ],
};

describe("defineSimulation", () => {
  test("the evaluator reduces, settles and projects the simulation", () => {
    const evaluator = createEvaluator({ scene: testScene(1), sequence, registry, simulations: [lamps] });
    expect(evaluator.warnings).toEqual([]);
    expect(evaluator.at(0).simulations.lamps).toEqual({ on: ["porch"], since: 0 });
    expect(evaluator.at(1500).simulations.lamps).toEqual({ on: ["desk", "porch"], since: 1000 });
    expect(evaluator.at(3000).projections.lamps).toEqual({ count: 1, onFor: 1000 });
    expect(evaluator.at(7000).projections.lamps).toEqual({ count: 0, onFor: 0 });
    // A seek back gives the state of playback.
    expect(evaluator.at(1500).simulations.lamps).toEqual({ on: ["desk", "porch"], since: 1000 });
  });

  test("the state schema checks a state", () => {
    expect(stateProblems(lamps, { on: [], since: 0 })).toEqual([]);
    expect(stateProblems(lamps, { since: 0 })).toEqual(["/on: not a list"]);
  });

  test("a bad ID or a missing function throws", () => {
    expect(() => defineSimulation({ ...lamps, id: "Lamps", reduce: (state) => state })).toThrow(
      "is not a simulation plugin ID",
    );
    const noProject = { ...lamps, project: undefined } as unknown as Parameters<typeof defineSimulation>[0];
    expect(() => defineSimulation(noProject)).toThrow("has no project function");
  });
});
