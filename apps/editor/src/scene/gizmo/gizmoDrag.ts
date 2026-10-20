// SPDX-License-Identifier: Apache-2.0
/**
 * The drag of a gizmo handle: from the press on a handle to the ops of each move
 * of the pointer. Each move starts again from the document at the press, so the same pointer gives the same ops.
 *
 * - An axis of the move gizmo: the place on the axis nearest to the ray of the pointer; the change goes on the grid.
 * - A plane of the move gizmo: the hit of the ray on the plane; each part goes on the grid.
 * - The centre of the move gizmo: the free move with the surface and socket snap (freeDrag.ts).
 * - A ring: the move of the pointer along the screen tangent of the ring at the press; the angle goes on the step.
 * - An axis of the scale gizmo: the move along the screen line of the axis; the centre box: a uniform scale.
 *
 * A typed value (values by keyboard) takes the place of the pointer: metres on an axis, degrees on a ring, a factor
 * on a scale handle. A plane and the free move take no typed value.
 */
import {
  axisFactor,
  axisFactors,
  axisParam,
  moveOps,
  planeHit,
  scaleOps,
  snapFactor,
  snapStep,
  tangentAngle,
  turnOps,
  typedNumber,
  type ActiveSnaps,
  type GizmoFrame,
  type Ray,
  type ScreenPoint,
} from "@scenity/editor-core";
import { vadd, vdot, vscale, vsub, type Vec3 } from "@scenity/scene/math";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import { freeOps, type FreeContext } from "./freeDrag";
import { HANDLE_PX, nearestSample, project, RING_STEPS, type Handle, type Projector } from "./gizmoHandles";
import type { GizmoSettings } from "./gizmoSettings";

/** The smallest screen speed of a ring (pixels per radian): a ring seen on its edge does not turn too fast. */
const MIN_RING_SPEED = 30;

/** A drag of a handle from its press. */
export interface HandleDrag {
  readonly handle: Handle;
  readonly doc: SceneDocument;
  readonly targets: readonly string[];
  readonly frame: GizmoFrame;
  readonly settings: GizmoSettings;
  readonly projector: Projector;
  /** The world size of the gizmo at the press (metres for HANDLE_PX). */
  readonly size: number;
  /** The pointer and its ray at the press. */
  readonly from: ScreenPoint;
  readonly ray: Ray;
  /** The screen speed of a ring at the press (pixels per radian, toward a positive turn). */
  readonly tangent: ScreenPoint | null;
  /** The free move of the centre handle of the move gizmo. */
  readonly free: FreeContext | null;
}

/** The screen tangent of a ring at the sample nearest to the press: pixels per radian toward a positive turn. */
export function ringTangent(drag: Pick<HandleDrag, "handle" | "projector">, from: ScreenPoint): ScreenPoint {
  const { handle, projector } = drag;
  const ring = handle.ring ?? [];
  const index = nearestSample(handle, from) % RING_STEPS;
  const here = ring[index];
  const next = ring[index + 1];
  const a = here === undefined ? null : project(projector, here);
  const b = next === undefined ? null : project(projector, next);
  if (a === null || b === null) return { x: MIN_RING_SPEED, y: 0 };
  const step = (2 * Math.PI) / RING_STEPS;
  const tangent = { x: (b.x - a.x) / step, y: (b.y - a.y) / step };
  const speed = Math.hypot(tangent.x, tangent.y);
  if (speed >= MIN_RING_SPEED) return tangent;
  if (speed < 1e-6) return { x: MIN_RING_SPEED, y: 0 };
  return { x: (tangent.x * MIN_RING_SPEED) / speed, y: (tangent.y * MIN_RING_SPEED) / speed };
}

/** The axis of a handle in the world. */
function axisOf(drag: HandleDrag): Vec3 {
  return drag.frame.axes[drag.handle.axis ?? 0];
}

/** The move of an axis or a plane of the move gizmo. */
function moveDelta(drag: HandleDrag, ray: Ray, snaps: ActiveSnaps, typed: number | null): Vec3 | null {
  const { frame, handle } = drag;
  const axis = axisOf(drag);
  if (handle.kind === "axis") {
    if (typed !== null) return vscale(axis, typed);
    const start = axisParam(drag.ray, frame.origin, axis);
    const now = axisParam(ray, frame.origin, axis);
    return start === null || now === null ? null : vscale(axis, snapStep(now - start, snaps.grid));
  }
  const start = planeHit(drag.ray, frame.origin, axis);
  const now = planeHit(ray, frame.origin, axis);
  if (start === null || now === null) return null;
  const change = vsub(now, start);
  let delta: Vec3 = [0, 0, 0];
  frame.axes.forEach((each, index) => {
    if (index !== handle.axis) delta = vadd(delta, vscale(each, snapStep(vdot(change, each), snaps.grid)));
  });
  return delta;
}

/** The pivot of a turn or a scale: the frame origin for the centre pivot, else null (each origin). */
function centreOf(drag: HandleDrag): Vec3 | null {
  return drag.settings.pivot === "centre" ? drag.frame.origin : null;
}

/** The scale factor of a scale handle. */
function scaleFactor(drag: HandleDrag, to: ScreenPoint, snaps: ActiveSnaps, typed: number | null): number {
  if (typed !== null) return typed;
  const { from, handle, frame, projector } = drag;
  if (handle.kind === "centre") return snapFactor(1 + (to.x - from.x - (to.y - from.y)) / HANDLE_PX, snaps.scale);
  const tip = project(projector, vadd(frame.origin, vscale(axisOf(drag), drag.size)));
  const centre = project(projector, frame.origin);
  if (tip === null || centre === null) return 1;
  return snapFactor(axisFactor(from, to, { x: tip.x - centre.x, y: tip.y - centre.y }), snaps.scale);
}

/** The ops of a handle drag for a pointer, its ray, the snaps and the typed text; null: no change to show. */
export function dragOps(
  drag: HandleDrag,
  to: ScreenPoint,
  ray: Ray,
  snaps: ActiveSnaps,
  typedText: string,
): SceneOp[] | null {
  const typed = drag.handle.kind === "plane" ? null : typedNumber(typedText);
  const { mode } = drag.settings;
  if (mode === "translate" && drag.handle.kind === "centre") {
    return drag.free === null ? null : (freeOps(drag.free, ray, snaps)?.ops ?? null);
  }
  if (mode === "translate") {
    const delta = moveDelta(drag, ray, snaps, typed);
    return delta === null ? null : moveOps(drag.doc, drag.targets, delta);
  }
  if (mode === "rotate") {
    const tangent = drag.tangent ?? { x: MIN_RING_SPEED, y: 0 };
    const free = tangentAngle(drag.from, to, tangent, Math.hypot(tangent.x, tangent.y));
    const angle = typed !== null ? (typed * Math.PI) / 180 : snapStep(free, snaps.angle);
    return turnOps(drag.doc, drag.targets, axisOf(drag), angle, centreOf(drag));
  }
  const factor = scaleFactor(drag, to, snaps, typed);
  const frame = drag.settings.pivot === "centre" ? drag.frame : null;
  return scaleOps(drag.doc, drag.targets, axisFactors(drag.handle.axis, factor), frame);
}
