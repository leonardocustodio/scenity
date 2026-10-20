// SPDX-License-Identifier: Apache-2.0
// The road crossing sample (samples/sim-road) with the traffic plugin. The markers of the sequence are the phase
// changes of the simulation, and no car enters on red. The road system hides a car before its key and lights the lamps
// of the phase. A seek gives the outputs of a play. The rules of the sequence run in `scenity check`
// (packages/cli/tests/checkPlugins.test.ts). The gallery checks the frames (sim-road.spec.ts).
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { createEvaluator, type SequenceDocument } from "@scenity/scene/sequence";
import { PluginHost } from "@scenity/runtime/plugins";
import { SystemSteps } from "@scenity/runtime/systemSteps";
import type { EntityOutput } from "@scenity/runtime/systems";
import traffic from "../src/runtime";
import type { TrafficInput } from "../src/simulation";

const SAMPLE = join(import.meta.dir, "../../../../samples/sim-road");
const read = <T>(path: string): T => JSON.parse(readFileSync(join(SAMPLE, path), "utf8")) as T;
const scene = read<SceneDocument>("scenes/road.scene.json");
const sequence = read<SequenceDocument>("sequences/rush.sequence.json");

/** The marker of the first time of each phase after the start. */
const PHASE_MARKERS: Readonly<Record<string, string>> = {
  amber: "amber",
  allRed: "red",
  walk: "walk",
  clearance: "clearance",
  green: "green",
};

/** The evaluator and the fixed steps of a document core over the sample. `at(t)` gives the outputs at `t`. */
function harness(): { at(t: number): Record<string, EntityOutput>; input(t: number): TrafficInput } {
  const host = new PluginHost([traffic]);
  const evaluator = createEvaluator({ scene, sequence, simulations: host.simulations, registry: host.components });
  const steps = new SystemSteps(host.createRunner({ core: {}, documentId: scene.id }));
  return {
    at: (t) =>
      steps
        .at(
          t,
          (time) => evaluator.at(time),
          (frame) => frame.projections,
        )
        ?.snapshot() ?? {},
    input: (t) => evaluator.at(t).projections.traffic as TrafficInput,
  };
}

describe("the road crossing sample", () => {
  const run = harness();

  it("has a marker at each phase change of the simulation", () => {
    const changes: Record<string, number> = {};
    let last = "green";
    for (let t = 0; t <= sequence.duration; t += 1) {
      const phase = run.input(t).phase;
      if (phase !== last) changes[PHASE_MARKERS[phase] ?? phase] ??= t;
      last = phase;
    }
    for (const [marker, t] of Object.entries(changes)) expect(sequence.markers?.[marker]).toBe(t);
    expect(Object.keys(changes).sort()).toEqual(["amber", "clearance", "green", "red", "walk"]);
  });

  it("lets no car enter on red, and every car and walker leaves the road", () => {
    const end = run.input(sequence.duration);
    expect(end.redEntries).toEqual([]);
    expect(end.cars).toEqual({});
    expect(end.walkers).toEqual({});
  });

  it("hides a car before its key, and lights the lamps of the phase", () => {
    const start = run.at(100);
    expect(start["car-6"]?.visible).toBe(false);
    expect(start["walker-1"]?.visible).toBe(false);
    expect(start["signal-east-green"]?.visible).toBe(true);
    expect(start["signal-east-green-dark"]?.visible).toBe(false);
    const walk = run.at((sequence.markers?.walk ?? 0) + 500);
    expect(walk["signal-east-red"]?.visible).toBe(true);
    expect(walk["signal-east-green"]?.visible).toBe(false);
    expect(walk["walk-north-walk"]?.visible).toBe(true);
    expect(walk["walk-north-wait"]?.visible).toBe(false);
    expect(walk["car-6"]?.visible).toBe(true);
    expect(walk["walker-1"]?.visible).toBe(true);
  });

  it("gives a seek back and a play again the outputs of the play", () => {
    const times = [3000, 7000, 12_000, 20_500];
    const played = times.map((t) => JSON.stringify(run.at(t)));
    const again = harness();
    for (const [index, t] of [...times].reverse().entries()) {
      expect(JSON.stringify(again.at(t))).toBe(played[times.length - 1 - index] ?? "");
    }
  });
});
