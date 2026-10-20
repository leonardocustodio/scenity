// SPDX-License-Identifier: Apache-2.0
// The math of the placement helpers over the world boxes of the entities: align, spread, drop to the floor, on,
// against, near, facing and a free place.
import { describe, expect, it } from "vitest";
import {
  againstMove,
  alignMoves,
  facingYaw,
  floorMove,
  freeMove,
  moved,
  nearMove,
  onMove,
  overlaps,
  spreadMoves,
  type Box,
} from "../../src/scene/placement/placementMath";

const box = (x: number, y: number, z: number, w = 1, h = 1, d = 1): Box => ({
  min: [x - w / 2, y, z - d / 2],
  max: [x + w / 2, y + h, z + d / 2],
});

describe("the placement math", () => {
  it("aligns and spreads on an axis", () => {
    const items = [
      { id: "a", box: box(0, 0, 0) },
      { id: "b", box: box(1, 0, 3) },
      { id: "c", box: box(10, 0, 1) },
    ];
    expect([...alignMoves(items, "z", "min")]).toEqual([
      ["b", [0, 0, -3]],
      ["c", [0, 0, -1]],
    ]);
    // a ends at 0.5 and c starts at 9.5: b goes to the middle of the room between them.
    expect([...spreadMoves(items, "x")]).toEqual([["b", [4, 0, 0]]]);
  });

  it("drops to the floor, puts on, against and near a target", () => {
    const table = box(0, 0, 0, 2, 0.8, 1);
    expect(floorMove(box(0.2, 2, 0, 0.2, 0.2, 0.2), [table])).toEqual([0, -1.2, 0]);
    expect(floorMove(box(5, 2, 0), [table])).toEqual([0, -2, 0]);
    expect(onMove(box(3, 0, 3, 0.2, 0.2, 0.2), table)).toEqual([-3, 0.8, -3]);
    expect(againstMove(box(3, 0, 3), table, "+x")).toEqual([-1.5, 0, -3]);
    const chair = box(5, 0, 5, 0.5, 1, 0.5);
    const at = moved(chair, nearMove(chair, table, 90, 0.2));
    // East of the table: a gap of 0.2 m from its +X side, in the middle of its depth.
    expect(at.min[0]).toBeCloseTo(1.2, 4);
    expect((at.min[2] + at.max[2]) / 2).toBeCloseTo(0, 4);
    expect(overlaps(at, table)).toBe(false);
    expect(facingYaw([1, 0, 0], [0, 0, 0])).toBe(90);
    expect(facingYaw([0, 0, -1], [0, 0, 0])).toBe(-180);
  });

  it("finds a free place on the floor near a point", () => {
    const table = box(0, 0, 0, 2, 0.8, 1);
    const crate = box(0, 1, 0, 0.5, 0.5, 0.5);
    const by = freeMove(crate, [table], [0, 0, 0]);
    if (by === null) throw new Error("no place");
    const placed = moved(crate, by);
    expect(placed.min[1]).toBe(0);
    expect(overlaps(placed, table)).toBe(false);
    expect(freeMove(crate, [box(0, 0, 0, 100, 2, 100)], [0, 0, 0], 0.25, 2)).toBeNull();
  });
});
