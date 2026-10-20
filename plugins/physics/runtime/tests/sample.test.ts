// SPDX-License-Identifier: Apache-2.0
// The physics sample (samples/physics) with its two plugins: the crates fall, the ball rolls down the ramp, the hero
// walks, the pusher pushes, and the marker of the probe plugin stays under the ball (a ray cast of another plugin).
// The sample replays to the same frames: a play, a seek to an earlier time and a play again give the same outputs bit
// for bit. The GPU test of the frames is apps/editor/tests/gallery/physics.spec.ts.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SequenceDocument } from "@scenity/scene/sequence";
import probe from "../../../../samples/physics/plugins/probe/src/runtime";
import physics from "../src/runtime";
import { harness, playTimes } from "./harness";

const SAMPLE = join(import.meta.dir, "../../../../samples/physics");
const read = <T>(path: string): T => JSON.parse(readFileSync(join(SAMPLE, path), "utf8")) as T;
const scene = read<SceneDocument>("scenes/physics.scene.json");
const sequence = read<SequenceDocument>("sequences/physics.sequence.json");

/** The three times of the check, in ms: after the fall, during the push, after the kick. */
const CHECKS = [1500, 5500, 7000];

describe("the physics sample", () => {
  const run = harness([physics, probe], scene, sequence);
  const times = playTimes(sequence.duration);
  const first = new Map(times.map((t) => [t, JSON.stringify(run.at(t))]));

  it("replays to the same frames: a seek back and a play again", () => {
    for (const t of CHECKS) expect(JSON.stringify(run.at(t))).toBe(first.get(t) ?? "");
    for (const t of times) if (t >= CHECKS[0]!) expect(JSON.stringify(run.at(t))).toBe(first.get(t) ?? "");
  });

  it("drops the crates, rolls the ball and walks the hero", () => {
    const frame = run.at(4000);
    for (const id of ["crate-1", "crate-2", "crate-3", "crate-4"]) {
      const y = frame[id]?.transform?.position?.[1] ?? Number.NaN;
      expect(y).toBeGreaterThan(0.15);
      expect(y).toBeLessThan(1.5);
    }
    const ball = frame.ball?.transform?.position ?? [];
    expect(ball[0]).toBeLessThan(1.2);
    const hero = frame.hero?.transform?.position ?? [];
    expect(hero[0]).toBeCloseTo(0.4 + 1.2 * 1.2, 1);
    expect(hero[1]).toBeCloseTo(0, 2);
  });

  it("keeps the marker of the probe plugin under the ball", () => {
    for (const t of CHECKS) {
      const frame = run.at(t);
      const ball = frame.ball?.transform?.position ?? [];
      const marker = frame["ball-marker"];
      expect(marker?.visible).toBe(true);
      const at = marker?.transform?.position ?? [];
      expect(at[0]).toBeCloseTo(ball[0] ?? Number.NaN, 6);
      expect(at[2]).toBeCloseTo(ball[2] ?? Number.NaN, 6);
      expect(at[1]).toBeLessThan(ball[1] ?? Number.NaN);
    }
  });
});
