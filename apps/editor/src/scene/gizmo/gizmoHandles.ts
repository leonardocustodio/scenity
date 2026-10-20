// SPDX-License-Identifier: Apache-2.0
/**
 * The handles of the transform gizmo on the canvas: their screen geometry from
 * the gizmo frame and the camera view of the document, and the hit test of a pointer. The gizmo has a constant size
 * on the screen (HANDLE_PX). No DOM: the overlay (gizmoDraw.ts) draws the handles, and the drag (gizmoDrag.ts) reads
 * them.
 *
 * - Move: an arrow on each axis, a square on each plane of two axes, and a centre ring for the free move.
 * - Turn: a ring round each axis.
 * - Scale: a line with a box on each axis, and a centre box for a uniform scale.
 */
import type { AxisIndex, GizmoFrame, ScreenPoint } from "@scenity/editor-core";
import { inPolygon, segmentDistance } from "@scenity/editor-core";
import { vadd, vscale, type Vec3 } from "@scenity/scene/math";
import { projectPoint, type CameraView } from "../dragMath";
import type { GizmoMode } from "./gizmoSettings";

/** The length of an axis handle on the screen (CSS pixels). */
export const HANDLE_PX = 90;
/** The hit distance of a line or a ring, and the radius of a centre handle (CSS pixels). */
const HIT_PX = 7;
const CENTRE_PX = 9;
/** The segments of a ring. */
const RING_STEPS = 48;

/** The ID of a handle: an axis, a plane of two axes, or the centre. */
export type HandleId = "x" | "y" | "z" | "xy" | "yz" | "zx" | "centre";

/** A handle on the screen. */
export interface Handle {
  readonly id: HandleId;
  readonly kind: "axis" | "plane" | "ring" | "centre";
  /** The axis of an axis or a ring handle; the normal axis of a plane handle; null for the centre. */
  readonly axis: AxisIndex | null;
  /** The line, the ring or the polygon of the handle; one point for the centre. */
  readonly points: readonly ScreenPoint[];
  /** The world points of a ring (the angle of a sample is `2π × index / RING_STEPS`). */
  readonly ring?: readonly Vec3[];
  /** Points to press the handle (the first one that hits it is the grab point of a test). */
  readonly grabs: readonly ScreenPoint[];
}

/** The gizmo on the screen: its centre, its world size (metres for HANDLE_PX) and its handles. */
export interface GizmoShape {
  readonly centre: ScreenPoint;
  readonly size: number;
  readonly handles: readonly Handle[];
}

const AXIS_IDS: readonly HandleId[] = ["x", "y", "z"];
const PLANE_IDS: readonly HandleId[] = ["yz", "zx", "xy"];

/** The screen projection of the frame; null for a point behind the camera. */
export interface Projector {
  readonly view: CameraView;
  readonly width: number;
  readonly height: number;
}

export function project(projector: Projector, point: Vec3): ScreenPoint | null {
  const at = projectPoint(projector.view, point, projector.width, projector.height);
  return at === null ? null : { x: at.x, y: at.y };
}

/** The point of the frame at the parts `a` and `b` of two axes (times the size). */
function framePoint(frame: GizmoFrame, size: number, parts: readonly [number, number, number]): Vec3 {
  let point = frame.origin;
  frame.axes.forEach((axis, index) => {
    point = vadd(point, vscale(axis, (parts[index] ?? 0) * size));
  });
  return point;
}

function axisParts(axis: number, value: number): [number, number, number] {
  const parts: [number, number, number] = [0, 0, 0];
  parts[axis] = value;
  return parts;
}

/** The handles of one axis: an arrow (move) or a line with a box (scale). */
function axisHandle(projector: Projector, frame: GizmoFrame, size: number, axis: AxisIndex): Handle | null {
  const from = project(projector, framePoint(frame, size, axisParts(axis, 0.2)));
  const to = project(projector, framePoint(frame, size, axisParts(axis, 1)));
  const grab = project(projector, framePoint(frame, size, axisParts(axis, 0.75)));
  if (from === null || to === null || grab === null) return null;
  return { id: AXIS_IDS[axis] ?? "x", kind: "axis", axis, points: [from, to], grabs: [grab, to] };
}

/** The square of the plane normal to `axis`. */
function planeHandle(projector: Projector, frame: GizmoFrame, size: number, axis: AxisIndex): Handle | null {
  const i = (axis + 1) % 3;
  const j = (axis + 2) % 3;
  const corner = (a: number, b: number): ScreenPoint | null => {
    const parts: [number, number, number] = [0, 0, 0];
    parts[i] = a;
    parts[j] = b;
    return project(projector, framePoint(frame, size, parts));
  };
  const points = [corner(0.3, 0.3), corner(0.55, 0.3), corner(0.55, 0.55), corner(0.3, 0.55)];
  const grab = corner(0.425, 0.425);
  if (grab === null || points.some((point) => point === null)) return null;
  return { id: PLANE_IDS[axis] ?? "xy", kind: "plane", axis, points: points as ScreenPoint[], grabs: [grab] };
}

/** The ring round `axis`: its samples start on the next axis and turn to the axis after it (a positive turn). */
function ringHandle(projector: Projector, frame: GizmoFrame, size: number, axis: AxisIndex): Handle | null {
  const i = (axis + 1) % 3;
  const j = (axis + 2) % 3;
  const ring: Vec3[] = [];
  const points: ScreenPoint[] = [];
  for (let step = 0; step <= RING_STEPS; step += 1) {
    const angle = (2 * Math.PI * step) / RING_STEPS;
    const parts: [number, number, number] = [0, 0, 0];
    parts[i] = Math.cos(angle);
    parts[j] = Math.sin(angle);
    const world = framePoint(frame, size, parts);
    const point = project(projector, world);
    if (point === null) return null;
    ring.push(world);
    points.push(point);
  }
  // The grab points: the samples between the axes first (they are far from the other rings).
  const order = [6, 18, 30, 42, 3, 9, 15, 21, 27, 33, 39, 45];
  const grabs = order.map((index) => points[index]).filter((point): point is ScreenPoint => point !== undefined);
  return { id: AXIS_IDS[axis] ?? "x", kind: "ring", axis, points, ring, grabs };
}

/** The gizmo of a mode on the screen, or null when its origin is behind the camera. */
export function gizmoShape(projector: Projector, frame: GizmoFrame, mode: GizmoMode): GizmoShape | null {
  // The View tool shows no gizmo.
  if (mode === "view") return null;
  const at = projectPoint(projector.view, frame.origin, projector.width, projector.height);
  if (at === null) return null;
  const tan = Math.tan((projector.view.fov * Math.PI) / 360);
  const size = (HANDLE_PX * at.depth * 2 * tan) / Math.max(1, projector.height);
  const centre = { x: at.x, y: at.y };
  const handles: (Handle | null)[] = [];
  for (const axis of [0, 1, 2] as const) {
    if (mode === "rotate") handles.push(ringHandle(projector, frame, size, axis));
    else handles.push(axisHandle(projector, frame, size, axis));
    if (mode === "translate") handles.push(planeHandle(projector, frame, size, axis));
  }
  if (mode !== "rotate") handles.push({ id: "centre", kind: "centre", axis: null, points: [centre], grabs: [centre] });
  return { centre, size, handles: handles.filter((handle): handle is Handle => handle !== null) };
}

/** The distance from a point to the line or the ring of a handle (pixels). */
function lineDistance(handle: Handle, point: ScreenPoint): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < handle.points.length; index += 1) {
    const a = handle.points[index - 1];
    const b = handle.points[index];
    if (a !== undefined && b !== undefined) best = Math.min(best, segmentDistance(point, a, b));
  }
  return best;
}

/** The handle under a point: the centre first, then the nearest line or ring, then a plane square; or null. */
export function hitHandle(shape: GizmoShape, point: ScreenPoint): Handle | null {
  const centre = shape.handles.find((handle) => handle.kind === "centre");
  if (centre !== undefined && Math.hypot(point.x - shape.centre.x, point.y - shape.centre.y) <= CENTRE_PX) {
    return centre;
  }
  let best: { handle: Handle; distance: number } | null = null;
  for (const handle of shape.handles) {
    if (handle.kind !== "axis" && handle.kind !== "ring") continue;
    const distance = lineDistance(handle, point);
    if (distance <= HIT_PX && (best === null || distance < best.distance)) best = { handle, distance };
  }
  if (best !== null) return best.handle;
  return shape.handles.find((handle) => handle.kind === "plane" && inPolygon(point, handle.points)) ?? null;
}

/** The grab point of a handle: the first of its points that hits it and that `accept` takes, or null. */
export function grabPoint(
  shape: GizmoShape,
  id: HandleId,
  accept: (point: ScreenPoint) => boolean = () => true,
): ScreenPoint | null {
  const handle = shape.handles.find((each) => each.id === id);
  if (handle === undefined) return null;
  // After the grab points: each ring sample, or the points along an axis line.
  const [a, b] = handle.points;
  const line =
    handle.kind === "axis" && a !== undefined && b !== undefined
      ? [0.9, 0.6, 0.4, 0.2].map((t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }))
      : [];
  const candidates = [...handle.grabs, ...(handle.kind === "ring" ? handle.points : line)];
  return candidates.find((point) => hitHandle(shape, point)?.id === id && accept(point)) ?? null;
}

/** The index of the ring sample nearest to a point on the screen. */
export function nearestSample(handle: Handle, point: ScreenPoint): number {
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  handle.points.forEach((sample, index) => {
    const d = Math.hypot(sample.x - point.x, sample.y - point.y);
    if (d < distance) [best, distance] = [index, d];
  });
  return best;
}

export { RING_STEPS };
