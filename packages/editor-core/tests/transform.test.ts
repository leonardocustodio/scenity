// SPDX-License-Identifier: Apache-2.0
// The transform edits of the gizmos: the snaps, the values by keyboard, the handle math and the move, turn and scale
// ops on the garden fixture. Each op list applies to the document.
import { describe, expect, it } from "bun:test";
import { applyOps } from "@scenity/scene/ops";
import { qfromAxisAngle, qrotate, type Vec3 } from "@scenity/scene/math";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { worldTransform } from "@scenity/scene/world";
import {
  activeSnaps,
  axisFactor,
  axisFactors,
  axisParam,
  DEFAULT_SNAPS,
  gizmoFrame,
  inPolygon,
  moveOps,
  planeHit,
  scaleOps,
  segmentDistance,
  snapFactor,
  snapStep,
  tangentAngle,
  transformTargets,
  turnOps,
  typedKey,
  typedNumber,
} from "../src/index";
import { components, garden } from "./helpers";

function apply(doc: SceneDocument, ops: Parameters<typeof applyOps>[1]): SceneDocument {
  const result = applyOps(doc, ops, components);
  if (!result.ok) throw new Error(result.reason);
  return result.doc;
}

function close(actual: readonly number[] | undefined, expected: readonly number[], digits = 5): void {
  expect(actual?.length).toBe(expected.length);
  expected.forEach((value, index) => {
    expect(actual?.[index]).toBeCloseTo(value, digits);
  });
}

/** The garden with the lamp turned 90° about y under the table, and the table moved and turned. */
function turnedGarden(): SceneDocument {
  return apply(garden(), [
    { op: "set", path: "/entities/table/components/transform/position", value: [1, 0, 0] },
    { op: "set", path: "/entities/table/components/transform/rotation", value: qfromAxisAngle([0, 1, 0], Math.PI / 2) },
  ]);
}

describe("the snaps", () => {
  it("give the steps of a drag from the settings and the keys", () => {
    expect(activeSnaps(DEFAULT_SNAPS, { alt: false, shift: false })).toEqual({
      grid: 0.01,
      angle: Math.PI / 12,
      scale: 0.1,
      surface: true,
    });
    expect(activeSnaps(DEFAULT_SNAPS, { alt: false, shift: true }).grid).toBeCloseTo(0.1, 9);
    expect(activeSnaps(DEFAULT_SNAPS, { alt: true, shift: false })).toEqual({
      grid: 0,
      angle: 0,
      scale: 0,
      surface: false,
    });
    expect(activeSnaps({ ...DEFAULT_SNAPS, gridOn: false, angleOn: false }, { alt: false, shift: false })).toEqual({
      grid: 0,
      angle: 0,
      scale: 0.1,
      surface: true,
    });
  });

  it("put values on the grid, the angle step and the factor step", () => {
    expect(snapStep(0.237, 0.1)).toBe(0.2);
    expect(snapStep(-0.26, 0.25)).toBe(-0.25);
    expect(snapStep(0.1234567891, 0)).toBe(0.123457);
    expect(snapStep(0.3, Math.PI / 12)).toBeCloseTo(Math.PI / 12, 6);
    expect(snapFactor(1.23, 0.1)).toBe(1.2);
    expect(snapFactor(0.46, 0.25)).toBe(0.5);
    expect(snapFactor(1.23, 0)).toBe(1.23);
  });

  it("read typed values key by key", () => {
    let text = "";
    for (const key of ["-", "0", ",", "5", ".", "x"]) text = typedKey(text, key) ?? text;
    expect(text).toBe("-0.5");
    expect(typedNumber(text)).toBe(-0.5);
    expect(typedKey("12", "Backspace")).toBe("1");
    expect(typedKey("12", "a")).toBeNull();
    expect(typedKey("-3", "-")).toBe("3");
    expect(typedNumber("")).toBeNull();
    expect(typedNumber("-")).toBeNull();
    expect(typedNumber("2.")).toBe(2);
    expect(typedNumber(".5")).toBe(0.5);
  });
});

describe("the handle math", () => {
  it("finds the place on an axis nearest to a ray", () => {
    const ray = { origin: [2, 5, 0] as Vec3, direction: [0, -1, 0] as Vec3 };
    expect(axisParam(ray, [0, 0, 0], [1, 0, 0])).toBeCloseTo(2, 9);
    expect(axisParam(ray, [0, 0, 0], [0, 1, 0])).toBeNull();
    close(planeHit(ray, [0, 1, 0], [0, 1, 0]) ?? [], [2, 1, 0]);
    expect(planeHit({ origin: [0, 0, 0], direction: [1, 0, 0] }, [0, 1, 0], [0, 1, 0])).toBeNull();
  });

  it("turns a move of the pointer into an angle and a factor", () => {
    expect(tangentAngle({ x: 0, y: 0 }, { x: 50, y: 10 }, { x: 2, y: 0 }, 100)).toBeCloseTo(0.5, 9);
    expect(axisFactor({ x: 0, y: 0 }, { x: 0, y: -40 }, { x: 0, y: -80 })).toBeCloseTo(1.5, 9);
    expect(segmentDistance({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(segmentDistance({ x: -4, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(inPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(inPolygon({ x: 5, y: 5 }, [...square].reverse())).toBe(true);
    expect(inPolygon({ x: 15, y: 5 }, square)).toBe(false);
  });
});

describe("the transform ops", () => {
  it("move, turn and scale an entity on each of three axes", () => {
    let doc = garden();
    for (const [axis, delta] of [
      [0, 0.5],
      [1, 0.25],
      [2, -0.4],
    ] as const) {
      const frame = gizmoFrame(doc, ["bench"], "world", "pivot");
      const move: Vec3 = [0, 0, 0];
      move[axis] = delta;
      doc = apply(doc, moveOps(doc, ["bench"], move));
      expect(frame?.origin).toBeDefined();
    }
    expect(doc.entities.bench?.components.transform).toEqual({ position: [2, 0.25, -1.4] });
    for (const axis of [0, 1, 2] as const) {
      const frame = gizmoFrame(doc, ["bench"], "world", "pivot");
      doc = apply(doc, turnOps(doc, ["bench"], frame?.axes[axis] ?? [1, 0, 0], Math.PI / 2, null));
    }
    // Three quarter turns about x, then y, then z of the world: a quarter turn about y in all.
    const rotation = (doc.entities.bench?.components.transform as { rotation: number[] }).rotation;
    close(rotation, qfromAxisAngle([0, 1, 0], Math.PI / 2));
    for (const [axis, factor] of [
      [0, 2],
      [1, 0.5],
      [2, 1.5],
    ] as const) {
      doc = apply(doc, scaleOps(doc, ["bench"], axisFactors(axis, factor), null));
    }
    expect((doc.entities.bench?.components.transform as { scale: number[] }).scale).toEqual([2, 0.5, 1.5]);
    expect((doc.entities.bench?.components.transform as { position: number[] }).position).toEqual([2, 0.25, -1.4]);
  });

  it("write local values through a turned parent", () => {
    const doc = turnedGarden();
    // The lamp is a child of the table: a world move of +x is a local move of +z under the quarter turn.
    const moved = apply(doc, moveOps(doc, ["lamp"], [0.5, 0, 0]));
    close((moved.entities.lamp?.components.transform as { position: number[] }).position, [0, 1.2, 0.5]);
    close(worldTransform(moved, "lamp")?.position ?? [], [1.5, 1.2, 0]);
    // A world turn of the lamp keeps the parent turn out of the local value.
    const turned = apply(doc, turnOps(doc, ["lamp"], [0, 1, 0], Math.PI / 2, null));
    close(worldTransform(turned, "lamp")?.rotation ?? [], qfromAxisAngle([0, 1, 0], Math.PI));
    close((turned.entities.lamp?.components.transform as { rotation: number[] }).rotation, [0, 0.707107, 0, 0.707107]);
  });

  it("give the local axes of the primary entity and the centre of the selection", () => {
    const doc = turnedGarden();
    const local = gizmoFrame(doc, ["table", "bench"], "local", "pivot");
    close(local?.origin ?? [], [1, 0, 0]);
    close(local?.axes[0] ?? [], qrotate(qfromAxisAngle([0, 1, 0], Math.PI / 2), [1, 0, 0]));
    const centre = gizmoFrame(doc, ["table", "bench"], "world", "centre");
    close(centre?.origin ?? [], [1.25, 0, -0.5]);
    expect(centre?.axes[0]).toEqual([1, 0, 0]);
  });

  it("turn and scale round the centre of the selection", () => {
    const doc = garden();
    const targets = ["table", "bench"];
    const frame = gizmoFrame(doc, targets, "world", "centre");
    const turned = apply(doc, turnOps(doc, targets, [0, 1, 0], Math.PI, frame?.origin ?? null));
    close(worldTransform(turned, "table")?.position ?? [], [1.5, 0, -1]);
    close(worldTransform(turned, "bench")?.position ?? [], [0, 0, 0]);
    const scaled = apply(doc, scaleOps(doc, targets, axisFactors(null, 2), frame));
    close(worldTransform(scaled, "table")?.position ?? [], [-0.75, 0, 0.5]);
    close(worldTransform(scaled, "bench")?.position ?? [], [2.25, 0, -1.5]);
    expect((scaled.entities.table?.components.transform as { scale: number[] }).scale).toEqual([2, 2, 2]);
  });

  it("leave out children of a selected entity, unknown and locked entities", () => {
    const doc = garden();
    expect(transformTargets(doc, ["lamp", "table", "nothing", "bench", "table"])).toEqual(["table", "bench"]);
    expect(transformTargets(doc, ["lamp", "bench"], (id) => id === "bench")).toEqual(["lamp"]);
    expect(gizmoFrame(doc, [], "world", "pivot")).toBeNull();
  });
});
