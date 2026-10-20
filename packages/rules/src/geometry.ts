// SPDX-License-Identifier: Apache-2.0
/**
 * The geometry of the metrics: distances, the angle at a joint, the overlap depth of two boxes, a segment through a
 * box, and floor polygons. The functions are pure and keep no state. The maths of the angle, the floor polygons and the
 * free width come from the motion and layout metrics of the first plugin. Thus the checks of that plugin give the same
 * values with the library.
 */
import type { FloorPoint } from "@scenity/character/path";
import type { FloorRect } from "@scenity/character/place";
import type { Box, Quat, Vec3 } from "./types";

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** A vector turned by a unit quaternion (x, y, z, w). */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** The distance of two points over the floor (x, z). */
export function floorDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

/** The angle at `joint` between the bones to `a` and to `b`, in degrees (180 is straight). */
export function jointAngle(a: Vec3, joint: Vec3, b: Vec3): number {
  const u = [a[0] - joint[0], a[1] - joint[1], a[2] - joint[2]] as const;
  const v = [b[0] - joint[0], b[1] - joint[1], b[2] - joint[2]] as const;
  const lengths = Math.hypot(...u) * Math.hypot(...v);
  if (lengths === 0) return 180;
  const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / lengths;
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

/**
 * How far two boxes go into each other (m): the smallest overlap over the axes, or 0 when they only touch or are
 * apart. `axes` gives the axes that count: all three, or X and Z for the floor.
 */
export function boxOverlap(a: Box, b: Box, axes: readonly number[] = [0, 1, 2]): number {
  let depth = Number.POSITIVE_INFINITY;
  for (const axis of axes) {
    const low = Math.max(a.min[axis] ?? 0, b.min[axis] ?? 0);
    const high = Math.min(a.max[axis] ?? 0, b.max[axis] ?? 0);
    depth = Math.min(depth, high - low);
  }
  return Math.max(0, depth);
}

/** A box made smaller by `margin` on each side. */
export function shrinkBox(box: Box, margin: number): Box {
  return {
    min: [box.min[0] + margin, box.min[1] + margin, box.min[2] + margin],
    max: [box.max[0] - margin, box.max[1] - margin, box.max[2] - margin],
  };
}

/** True when the segment `from` → `to` goes through the inside of a box (a slab test; a touch does not count). */
export function segmentHitsBox(from: Vec3, to: Vec3, box: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  for (const axis of [0, 1, 2]) {
    const start = from[axis] ?? 0;
    const delta = (to[axis] ?? 0) - start;
    const low = box.min[axis] ?? 0;
    const high = box.max[axis] ?? 0;
    if (Math.abs(delta) < 1e-12) {
      if (start <= low || start >= high) return false;
      continue;
    }
    const ta = (low - start) / delta;
    const tb = (high - start) / delta;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
    if (t0 >= t1) return false;
  }
  return true;
}

/** The distance from a point to a box (0 inside). */
export function pointToBox(point: Vec3, box: Box): number {
  const dx = Math.max(box.min[0] - point[0], 0, point[0] - box.max[0]);
  const dy = Math.max(box.min[1] - point[1], 0, point[1] - box.max[1]);
  const dz = Math.max(box.min[2] - point[2], 0, point[2] - box.max[2]);
  return Math.hypot(dx, dy, dz);
}

/** The floor rectangle under a box. */
export function floorRectOf(box: Box): FloorRect {
  return { minX: box.min[0], maxX: box.max[0], minZ: box.min[2], maxZ: box.max[2] };
}

/** The 4 corners of a floor rectangle. */
export function rectCorners(rect: FloorRect): FloorPoint[] {
  return [
    [rect.minX, rect.minZ],
    [rect.maxX, rect.minZ],
    [rect.maxX, rect.maxZ],
    [rect.minX, rect.maxZ],
  ];
}

/** True when a point of the floor is inside a convex polygon (the corners in either turn). */
export function insidePolygon(point: FloorPoint, polygon: readonly FloorPoint[]): boolean {
  let sign = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index] ?? point;
    const b = polygon[(index + 1) % polygon.length] ?? point;
    const cross = (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
    if (cross === 0) continue;
    const side = Math.sign(cross);
    if (sign === 0) sign = side;
    else if (side !== sign) return false;
  }
  return true;
}

/** The distance from a point along a direction (unit) to the first edge of a polygon, or null when it hits none. */
export function rayToPolygon(from: FloorPoint, direction: FloorPoint, polygon: readonly FloorPoint[]): number | null {
  let best: number | null = null;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index] ?? from;
    const b = polygon[(index + 1) % polygon.length] ?? from;
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const denominator = direction[0] * ez - direction[1] * ex;
    if (Math.abs(denominator) < 1e-12) continue;
    const wx = a[0] - from[0];
    const wz = a[1] - from[1];
    const t = (wx * ez - wz * ex) / denominator;
    const u = (wx * direction[1] - wz * direction[0]) / denominator;
    if (t >= 0 && u >= 0 && u <= 1 && (best === null || t < best)) best = t;
  }
  return best;
}

/** The distance on the floor from a point to a convex polygon (0 inside). */
export function toPolygon(point: FloorPoint, polygon: readonly FloorPoint[]): number {
  if (insidePolygon(point, polygon)) return 0;
  let best = Number.POSITIVE_INFINITY;
  polygon.forEach((a, index) => {
    const b = polygon[(index + 1) % polygon.length] ?? a;
    const [ex, ez] = [b[0] - a[0], b[1] - a[1]];
    const length = ex * ex + ez * ez;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * ex + (point[1] - a[1]) * ez) / length));
    best = Math.min(best, Math.hypot(point[0] - (a[0] + ex * t), point[1] - (a[1] + ez * t)));
  });
  return best;
}

/** The points of a route each `step` metres, with the ends of each part. */
export function samples(route: readonly Vec3[], step: number): Vec3[] {
  const out: Vec3[] = [];
  route.forEach((point, index) => {
    const next = route[index + 1];
    out.push(point);
    if (next === undefined) return;
    const length = Math.hypot(next[0] - point[0], next[1] - point[1], next[2] - point[2]);
    const count = Math.floor(length / step);
    for (let part = 1; part < count; part += 1) {
      const t = part / count;
      out.push([
        point[0] + (next[0] - point[0]) * t,
        point[1] + (next[1] - point[1]) * t,
        point[2] + (next[2] - point[2]) * t,
      ]);
    }
  });
  return out;
}

/** The length of a route. */
export function routeLength(route: readonly Vec3[]): number {
  let total = 0;
  for (let index = 1; index < route.length; index += 1) {
    const a = route[index - 1];
    const b = route[index];
    if (a !== undefined && b !== undefined) total += distance(a, b);
  }
  return total;
}
