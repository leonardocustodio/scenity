// SPDX-License-Identifier: Apache-2.0
// The walks of the characters (src/path.ts, src/locomotion.ts): a path around an obstacle, the engine walk time,
// and the place that a walk leaves.
import { describe, expect, it } from "bun:test";
import { walkOrigin, type WalkFloor, type WalkerInput } from "../src/locomotion";
import { crosses, planPath, planWalk, walkState } from "../src/path";
import type { FloorRect, Slot } from "../src/place";

const BOX: FloorRect = { minX: -0.5, maxX: 0.5, minZ: -1, maxZ: 1 };
const HOME: Slot = { at: [2, 0], face: [0, 0] };
const FLOOR: WalkFloor = { obstacles: [BOX], slotOf: (anchor) => (anchor === "home" ? HOME : undefined) };

function walker(parts: Partial<WalkerInput> = {}): WalkerInput {
  return { activity: "idle", phaseStartMs: null, unavailable: false, walkEndMs: null, ...parts };
}

describe("walks", () => {
  it("goes around an obstacle", () => {
    const path = planPath([-1, 0], [1, 0], FLOOR.obstacles);
    expect(path.length).toBeGreaterThan(2);
    for (let index = 1; index < path.length; index += 1) {
      expect(crosses(path[index - 1] ?? [0, 0], path[index] ?? [0, 0], BOX)).toBe(false);
    }
  });

  it("takes the walk time of the engine and ends at the target", () => {
    const walk = planWalk([-1, 0], [1, 0], FLOOR.obstacles, 10_000, 13_000);
    expect(walk?.endMs).toBe(13_000);
    if (walk === null) return;
    expect(walkState(walk, 11_500).done).toBe(false);
    const end = walkState(walk, 13_000);
    expect(end.done).toBe(true);
    expect(end.at[0]).toBeCloseTo(1, 5);
    expect(end.at[1]).toBeCloseTo(0, 5);
  });

  it("has no walk for a step shorter than 5 cm", () => {
    expect(planWalk([2, 0], [2.02, 0], FLOOR.obstacles, 0, null)).toBeNull();
  });

  it("starts an engine walk at the slot of the anchor that it leaves, and a timed walk at its own slot", () => {
    expect(walkOrigin(walker({ activity: "walk", fromAnchor: "home" }), null, FLOOR)).toBe(HOME);
    expect(walkOrigin(walker({ activity: "walk", fromAnchor: "away" }), null, FLOOR)).toBeNull();
    expect(walkOrigin(walker(), null, FLOOR)).toBeNull();
    expect(walkOrigin(walker(), { startMs: 0, endMs: null, from: HOME }, FLOOR)).toBe(HOME);
  });
});
