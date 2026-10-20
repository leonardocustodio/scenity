// SPDX-License-Identifier: Apache-2.0
// The transform gizmos of the scene page: the handles on the screen through the camera of the document, the hit test of
// a pointer, and the ops of a handle drag with a pointer or a typed value. The showroom scene and its front camera,
// with no DOM and no core.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { activeSnaps, DEFAULT_SNAPS, gizmoFrame } from "@scenity/editor-core";
import { applyOps } from "@scenity/scene/ops";
import { builtinRegistry } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { cameraEntity, cameraView, projectPoint, viewRay, type CameraView } from "../../src/scene/dragMath";
import { dragOps, ringTangent, type HandleDrag } from "../../src/scene/gizmo/gizmoDrag";
import { gizmoShape, grabPoint, hitHandle, type HandleId } from "../../src/scene/gizmo/gizmoHandles";
import { DEFAULT_GIZMO, type GizmoMode } from "../../src/scene/gizmo/gizmoSettings";
import { parseScene } from "../../src/scene/project";

const SCENE = join(import.meta.dirname, "../../../../samples/showroom/scenes/main.scene.json");
const WIDTH = 1280;
const HEIGHT = 720;
const SNAPS = activeSnaps(DEFAULT_SNAPS, { alt: false, shift: false });

function showroom(): { doc: SceneDocument; view: CameraView } {
  const doc = parseScene(readFileSync(SCENE, "utf8"));
  const camera = cameraEntity(doc, "front");
  const view = camera === null ? null : cameraView(doc, camera);
  if (view === null) throw new Error("no front camera");
  return { doc, view };
}

/** A drag of a handle of the coffee table from its grab point. */
function pressed(doc: SceneDocument, view: CameraView, mode: GizmoMode, id: HandleId): HandleDrag {
  const targets = ["coffee-table"];
  const frame = gizmoFrame(doc, targets, mode === "scale" ? "local" : "world", "pivot");
  const projector = { view, width: WIDTH, height: HEIGHT };
  if (frame === null) throw new Error("no frame");
  const shape = gizmoShape(projector, frame, mode);
  const handle = shape?.handles.find((each) => each.id === id);
  const from = shape === null ? null : grabPoint(shape, id);
  if (shape === null || handle === undefined || from === null) throw new Error(`no handle ${id}`);
  const ray = viewRay(view, from.x, from.y, WIDTH, HEIGHT);
  const tangent = handle.kind === "ring" ? ringTangent({ handle, projector }, from) : null;
  const settings = { ...DEFAULT_GIZMO, mode };
  return { handle, doc, targets, frame, settings, projector, size: shape.size, from, ray, tangent, free: null };
}

/** The transform of the coffee table after the ops of a drag. */
function after(doc: SceneDocument, ops: ReturnType<typeof dragOps>): Record<string, number[]> {
  const result = applyOps(doc, ops ?? [], builtinRegistry());
  if (!result.ok) throw new Error(result.reason);
  return result.doc.entities["coffee-table"]?.components.transform as Record<string, number[]>;
}

describe("the gizmo handles on the screen", () => {
  it("project a world point to the canvas point of its ray", () => {
    const { view } = showroom();
    const ray = viewRay(view, 300, 200, WIDTH, HEIGHT);
    const point = ray.direction.map((value, index) => (ray.origin[index] ?? 0) + 3 * value) as [number, number, number];
    const back = projectPoint(view, point, WIDTH, HEIGHT);
    expect(back?.x).toBeCloseTo(300, 6);
    expect(back?.y).toBeCloseTo(200, 6);
    expect(back?.depth).toBeGreaterThan(0);
    expect(projectPoint(view, [0.4, 1.7, 8], WIDTH, HEIGHT)).toBeNull();
  });

  it("give each mode its handles, and the hit test finds each one at its grab point", () => {
    const { doc, view } = showroom();
    const frame = gizmoFrame(doc, ["coffee-table"], "world", "pivot");
    if (frame === null) throw new Error("no frame");
    const projector = { view, width: WIDTH, height: HEIGHT };
    // The View tool has no gizmo.
    expect(gizmoShape(projector, frame, "view")).toBeNull();
    const expected: Record<Exclude<GizmoMode, "view">, string[]> = {
      translate: ["x", "yz", "y", "zx", "z", "xy", "centre"],
      rotate: ["x", "y", "z"],
      scale: ["x", "y", "z", "centre"],
    };
    for (const mode of ["translate", "rotate", "scale"] as const) {
      const shape = gizmoShape(projector, frame, mode);
      expect(shape?.handles.map((handle) => handle.id)).toEqual(expected[mode]);
      for (const handle of shape?.handles ?? []) {
        const point = shape === null ? null : grabPoint(shape, handle.id);
        expect(point, `${mode} ${handle.id}`).not.toBeNull();
        if (shape !== null && point !== null) expect(hitHandle(shape, point)?.id).toBe(handle.id);
      }
      expect(shape === null ? null : hitHandle(shape, { x: 5, y: 5 })).toBeNull();
    }
  });
});

describe("the ops of a handle drag", () => {
  it("move on an axis with the grid, or by a typed value", () => {
    const { doc, view } = showroom();
    const drag = pressed(doc, view, "translate", "x");
    const [a, b] = drag.handle.points;
    if (a === undefined || b === undefined) throw new Error("no axis line");
    const to = { x: drag.from.x + (b.x - a.x) * 0.5, y: drag.from.y + (b.y - a.y) * 0.5 };
    const ray = viewRay(view, to.x, to.y, WIDTH, HEIGHT);
    const moved = after(doc, dragOps(drag, to, ray, SNAPS, ""));
    expect(moved.position?.[0]).toBeGreaterThan(-1.2);
    expect(Math.abs(Math.round((moved.position?.[0] ?? 0) * 100) - (moved.position?.[0] ?? 0) * 100)).toBeLessThan(
      1e-6,
    );
    expect([moved.position?.[1], moved.position?.[2]]).toEqual([0, 0.3]);
    expect(after(doc, dragOps(drag, to, ray, SNAPS, "-0.25")).position).toEqual([-1.45, 0, 0.3]);
  });

  it("turn on a ring by the angle step, or by typed degrees", () => {
    const { doc, view } = showroom();
    const drag = pressed(doc, view, "rotate", "y");
    const tangent = drag.tangent ?? { x: 1, y: 0 };
    // A move of 0.3 rad along the tangent goes to the 15° step (0.2618 rad).
    const to = { x: drag.from.x + tangent.x * 0.3, y: drag.from.y + tangent.y * 0.3 };
    const turned = after(doc, dragOps(drag, to, drag.ray, SNAPS, ""));
    // The table has a quarter turn about y: 15° more gives 105° about y.
    const angle = (2 * Math.atan2(turned.rotation?.[1] ?? 0, turned.rotation?.[3] ?? 1) * 180) / Math.PI;
    expect(angle).toBeCloseTo(105, 3);
    const typed = after(doc, dragOps(drag, drag.from, drag.ray, SNAPS, "-90"));
    expect(typed.rotation).toEqual([0, 0, 0, 1]);
  });

  it("scale on an axis by the factor step, or by a typed factor; the centre box scales on each axis", () => {
    const { doc, view } = showroom();
    const drag = pressed(doc, view, "scale", "y");
    const [a, b] = drag.handle.points;
    if (a === undefined || b === undefined) throw new Error("no axis line");
    // The axis line runs from 0.2 to 1 of the size: a move of its screen length is 0.8 of a size (a factor of 1.8).
    const to = { x: drag.from.x + (b.x - a.x), y: drag.from.y + (b.y - a.y) };
    expect(after(doc, dragOps(drag, to, drag.ray, SNAPS, "")).scale).toEqual([1, 1.8, 1]);
    expect(after(doc, dragOps(drag, to, drag.ray, SNAPS, "0.5")).scale).toEqual([1, 0.5, 1]);
    const uniform = pressed(doc, view, "scale", "centre");
    const right = { x: uniform.from.x + 45, y: uniform.from.y };
    expect(after(doc, dragOps(uniform, right, uniform.ray, SNAPS, "")).scale).toEqual([1.5, 1.5, 1.5]);
  });
});
