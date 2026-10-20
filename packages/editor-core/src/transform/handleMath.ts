// SPDX-License-Identifier: Apache-2.0
/**
 * The math of a gizmo handle: the place on an axis line nearest to the ray of the pointer, the hit of a ray on a plane,
 * the hit on a level plane, and the angle of a turn from a move along the tangent of a ring on the screen. Pure
 * functions, no DOM.
 */
import { vadd, vdot, vlength, vscale, vsub, type Vec3 } from "@scenity/scene/math";

/** A ray in the world: an origin and a unit direction. */
export interface Ray {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

/**
 * The parameter `s` of the point `origin + s × axis` nearest to the ray, or null when the ray is almost parallel to
 * the axis (`axis` is a unit vector).
 */
export function axisParam(ray: Ray, origin: Vec3, axis: Vec3): number | null {
  const w = vsub(origin, ray.origin);
  const b = vdot(axis, ray.direction);
  const denominator = 1 - b * b;
  if (denominator < 1e-6) return null;
  const d = vdot(axis, w);
  const e = vdot(ray.direction, w);
  return (b * e - d) / denominator;
}

/** The point where a ray meets the plane through `origin` with the `normal`. Null behind the ray or when parallel. */
export function planeHit(ray: Ray, origin: Vec3, normal: Vec3): Vec3 | null {
  const facing = vdot(ray.direction, normal);
  if (Math.abs(facing) < 1e-6) return null;
  const t = vdot(vsub(origin, ray.origin), normal) / facing;
  return t > 0 ? vadd(ray.origin, vscale(ray.direction, t)) : null;
}

/** The point where a ray meets the level plane at the height `y`, or null when it does not meet it in front. */
export function levelHit(ray: Ray, y: number): Vec3 | null {
  return planeHit(ray, [0, y, 0], [0, 1, 0]);
}

/** The distance from the ray origin to a point. */
export function rayDistance(ray: Ray, point: Vec3): number {
  return vlength(vsub(point, ray.origin));
}

/** A point on the screen (CSS pixels). */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The angle of a turn (radians) for a move of the pointer from `from` to `to`: the part of the move along the screen
 * tangent of the ring at the grab point, over the radius of the ring in pixels. The tangent points to a positive turn.
 */
export function tangentAngle(from: ScreenPoint, to: ScreenPoint, tangent: ScreenPoint, radius: number): number {
  const length = Math.hypot(tangent.x, tangent.y);
  if (length < 1e-9 || radius <= 0) return 0;
  const along = ((to.x - from.x) * tangent.x + (to.y - from.y) * tangent.y) / length;
  return along / radius;
}

/** The scale factor for a move of the pointer along the screen direction of an axis of `length` pixels. */
export function axisFactor(from: ScreenPoint, to: ScreenPoint, axis: ScreenPoint): number {
  const length2 = axis.x * axis.x + axis.y * axis.y;
  if (length2 < 1e-9) return 1;
  return 1 + ((to.x - from.x) * axis.x + (to.y - from.y) * axis.y) / length2;
}

/** The distance from a point to the segment `a` → `b` on the screen. */
export function segmentDistance(point: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** True when a point is in a convex polygon on the screen (either winding). */
export function inPolygon(point: ScreenPoint, polygon: readonly ScreenPoint[]): boolean {
  let sign = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    if (a === undefined || b === undefined) return false;
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return polygon.length >= 3;
}
