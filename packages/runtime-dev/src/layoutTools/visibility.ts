// SPDX-License-Identifier: Apache-2.0
/**
 * The visibility tool: the share of a rectangle that an eye sees, with the `visible` metric. The rectangle faces the +Z
 * axis of its entity (a screen faces +Z of its prop).
 *
 * - **The eye**: the request, else the first of two selected entities (its head bone when it has one), else the
 *   place of the camera that draws (`viewpoint`).
 * - **The rectangle**: the request, else the front face (+Z) of the box of the target, a little smaller than the face
 *   (INSET), so the points do not touch the floor.
 * - The overlay draws the outline of the rectangle and a sight line to each point of the sample grid: green when the
 *   point is visible, red when an entity hides it.
 */
import { rectanglePoints, type MetricContext, type PointArg, type Vec3 } from "@scenity/rules";
import { rotate } from "@scenity/rules/geometry";
import {
  emptyShapes,
  entityRef,
  middle,
  noInput,
  pointWords,
  refEntity,
  runMetric,
  type LayoutToolResult,
  type VisibilityRequest,
} from "./shared";

/** The default count of the sample points on each side of the rectangle. */
const GRID = 3;

/** The eye of a selected entity: its head bone, else its origin. */
function eyeOf(ctx: MetricContext, id: string): PointArg {
  return ctx.entity(id)?.joints?.head === undefined ? entityRef(id) : `${entityRef(id)}#head`;
}

/**
 * The share of the box face that the default rectangle covers: an inset keeps the points off the floor and the sides.
 */
const INSET = 0.9;

/**
 * The rectangle of a target from its box: the front face (+Z of the target) of the box, at INSET of its size on the X
 * and Y axes of the target.
 */
function boxRectangle(ctx: MetricContext, id: string): { at: Vec3; size: [number, number] } | null {
  const entity = ctx.entity(id);
  const box = entity?.bounds ?? null;
  if (entity === undefined || box === null) return null;
  const half: Vec3 = [(box.max[0] - box.min[0]) / 2, (box.max[1] - box.min[1]) / 2, (box.max[2] - box.min[2]) / 2];
  const extent = (axis: Vec3): number => {
    const world = rotate(entity.transform.rotation, axis);
    return 2 * (Math.abs(world[0]) * half[0] + Math.abs(world[1]) * half[1] + Math.abs(world[2]) * half[2]);
  };
  const size: [number, number] = [Math.max(0.01, extent([1, 0, 0]) * INSET), Math.max(0.01, extent([0, 1, 0]) * INSET)];
  const normal = rotate(entity.transform.rotation, [0, 0, 1]);
  const depth = extent([0, 0, 1]) / 2;
  const mid = middle(box.min, box.max);
  return { at: [mid[0] + normal[0] * depth, mid[1] + normal[1] * depth, mid[2] + normal[2] * depth], size };
}

export function visibilityTool(ctx: MetricContext, request: VisibilityRequest): LayoutToolResult {
  const selected = request.selection ?? [];
  const target = request.target ?? selected[selected.length - 1];
  if (target === undefined) return noInput("visibility", "Visibility needs a target: select the entity to see.");
  const eye =
    request.eye ?? (selected.length >= 2 && selected[0] !== undefined ? eyeOf(ctx, selected[0]) : request.viewpoint);
  if (eye === undefined || eye === null) {
    return noInput("visibility", "Visibility needs an eye: select the eye first, then the target.");
  }
  const fromBox = boxRectangle(ctx, target);
  const at = request.at ?? fromBox?.at;
  const size = request.size ?? fromBox?.size;
  const eyePoint = ctx.point(eye);
  const rotation = ctx.entity(target)?.transform.rotation;
  const centre = at === undefined ? null : ctx.point(at);
  if (size === undefined || centre === null || eyePoint === null || rotation === undefined) {
    return noInput("visibility", `${target} has no box, and the request gives no rectangle.`);
  }
  const grid = request.grid ?? GRID;
  const occluders = request.occluders ?? "bounds";
  const args = { eye, at: centre, size: [...size], frame: target, grid, occluders };
  const run = runMetric(ctx, "visible", args);
  const shapes = emptyShapes();
  const corners = rectanglePoints(centre, rotation, size, 2);
  const [a, b, c, d] = corners;
  if (a !== undefined && b !== undefined && c !== undefined && d !== undefined) {
    shapes.lines.push({ points: [a, b, d, c], tone: "measure", closed: true });
  }
  const skip = [target, refEntity(eye)].filter((id): id is string => id !== null);
  const facing = run.result?.value !== 0 || !(run.result.detail ?? "").includes("faces away");
  for (const point of rectanglePoints(centre, rotation, size, grid)) {
    const hidden = !facing || ctx.blocker(eyePoint, point, skip, occluders, 0.01) !== null;
    shapes.lines.push({ points: [eyePoint, point], tone: hidden ? "blocked" : "walk" });
  }
  shapes.dots.push({ at: eyePoint, tone: "place" });
  const share = run.result?.value ?? null;
  const text = share === null ? "no value" : `${String(Math.round(share * 100))} % visible`;
  shapes.labels.push({ at: centre, text, tone: "measure" });
  const line = `${pointWords(eye)} to ${target}: ${text} (${run.result?.detail ?? run.error ?? ""})`;
  const subjects = [refEntity(eye), target].filter((id): id is string => id !== null);
  return { tool: "visibility", ok: true, reason: null, subjects, metrics: [run], lines: [line], overlay: shapes };
}
