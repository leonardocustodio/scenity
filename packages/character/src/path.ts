// SPDX-License-Identifier: Apache-2.0
/**
 * The walks of the characters: the shortest path on the floor that goes around the obstacles, and the place on that
 * path at a simulation time. The walk takes the walk time of the engine, so a character that walks 3 s in the engine
 * walks 3 s on screen.
 */
import type { FloorRect } from "./place";

export type FloorPoint = readonly [number, number];

/** The corners of a walk keep this space from an obstacle, in metres (half a body width). */
export const CLEARANCE = 0.28;
/** The center of a body on a walk never comes nearer than this to an obstacle. */
export const BODY_MARGIN = 0.05;
/** The natural walk speed in metres per second, for a walk without an engine walk time. */
export const WALK_SPEED = 1.25;

function grow(rect: FloorRect, by: number): FloorRect {
  return { minX: rect.minX - by, maxX: rect.maxX + by, minZ: rect.minZ - by, maxZ: rect.maxZ + by };
}

function inside(point: FloorPoint, rect: FloorRect): boolean {
  return point[0] > rect.minX && point[0] < rect.maxX && point[1] > rect.minZ && point[1] < rect.maxZ;
}

/** True when the segment a–b goes through the inside of the rectangle (a segment along an edge does not cross it). */
export function crosses(a: FloorPoint, b: FloorPoint, rect: FloorRect): boolean {
  // The Liang–Barsky clip algorithm on the open rectangle.
  const eps = 1e-6;
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const edges: [number, number][] = [
    [-dx, a[0] - (rect.minX + eps)],
    [dx, rect.maxX - eps - a[0]],
    [-dz, a[1] - (rect.minZ + eps)],
    [dz, rect.maxZ - eps - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t1 - t0 > eps;
}

function length(a: FloorPoint, b: FloorPoint): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * The shortest path from `from` to `to` around the obstacles: a visibility graph of the corners of the
 * obstacles, grown by the clearance. No segment crosses an obstacle grown by the body margin. An end point
 * at an obstacle (a stand point at a cart) ignores that obstacle. Without a free path the walk goes straight.
 */
export function planPath(from: FloorPoint, to: FloorPoint, obstacles: readonly FloorRect[]): FloorPoint[] {
  // A stand point at a cart is near (or in) the cart: the walk ignores the obstacle of its own end points.
  const bodies = obstacles
    .map((rect) => grow(rect, BODY_MARGIN))
    .filter((rect) => !inside(from, rect) && !inside(to, rect));
  const blocked = (a: FloorPoint, b: FloorPoint): boolean => bodies.some((rect) => crosses(a, b, rect));
  if (!blocked(from, to)) return [from, to];
  const corners: FloorPoint[] = [];
  for (const rect of bodies.map((body) => grow(body, CLEARANCE - BODY_MARGIN))) {
    for (const corner of [
      [rect.minX, rect.minZ],
      [rect.maxX, rect.minZ],
      [rect.maxX, rect.maxZ],
      [rect.minX, rect.maxZ],
    ] as const) {
      if (!bodies.some((body) => inside(corner, body))) corners.push(corner);
    }
  }
  const nodes: FloorPoint[] = [from, ...corners, to];
  const target = nodes.length - 1;
  const distance = nodes.map(() => Number.POSITIVE_INFINITY);
  const previous = nodes.map(() => -1);
  const done = nodes.map(() => false);
  distance[0] = 0;
  for (;;) {
    let current = -1;
    for (let index = 0; index < nodes.length; index += 1) {
      if (!done[index] && (current === -1 || (distance[index] ?? 0) < (distance[current] ?? 0))) current = index;
    }
    if (current === -1 || !Number.isFinite(distance[current] ?? Number.POSITIVE_INFINITY)) break;
    if (current === target) break;
    done[current] = true;
    const here = nodes[current] ?? from;
    for (let next = 0; next < nodes.length; next += 1) {
      const there = nodes[next] ?? to;
      if (done[next] || next === current || blocked(here, there)) continue;
      const candidate = (distance[current] ?? 0) + length(here, there);
      if (candidate < (distance[next] ?? Number.POSITIVE_INFINITY)) {
        distance[next] = candidate;
        previous[next] = current;
      }
    }
  }
  if (previous[target] === -1) return [from, to];
  const path: FloorPoint[] = [];
  for (let index = target; index !== -1; index = previous[index] ?? -1) path.push(nodes[index] ?? to);
  return path.reverse();
}

/** The length of a path in metres. */
export function pathLength(path: readonly FloorPoint[]): number {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    total += length(path[index - 1] ?? [0, 0], path[index] ?? [0, 0]);
  }
  return total;
}

/** The place and the walk direction at a share (0 to 1) of the path length. */
export function pointAt(path: readonly FloorPoint[], share: number): { at: FloorPoint; heading: number } {
  const first = path[0] ?? [0, 0];
  if (path.length < 2) return { at: first, heading: 0 };
  let left = Math.min(1, Math.max(0, share)) * pathLength(path);
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1] ?? first;
    const b = path[index] ?? first;
    const part = length(a, b);
    if (left <= part || index === path.length - 1) {
      const t = part === 0 ? 1 : Math.min(1, left / part);
      return {
        at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        heading: Math.atan2(b[0] - a[0], b[1] - a[1]),
      };
    }
    left -= part;
  }
  const last = path[path.length - 1] ?? first;
  return { at: last, heading: 0 };
}

/** One walk: the path and its simulation times. */
export interface Walk {
  readonly path: readonly FloorPoint[];
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * Make a walk. With the engine walk end (later than now), the walk ends then. The walk starts at the engine walk
 * start when that is in the past, else now. The place is (simMs − phase start) / walk time, so a late view puts the
 * member on its path. Without the engine end, the walk starts now at the natural walk speed. A walk shorter than
 * 5 cm is no walk.
 */
export function planWalk(
  from: FloorPoint,
  to: FloorPoint,
  obstacles: readonly FloorRect[],
  nowMs: number,
  engineEndMs: number | null,
  engineStartMs: number | null = null,
): Walk | null {
  if (length(from, to) < 0.05) return null;
  const path = planPath(from, to, obstacles);
  if (engineEndMs !== null && engineEndMs > nowMs + 100) {
    const startMs = engineStartMs !== null && engineStartMs < nowMs ? engineStartMs : nowMs;
    return { path, startMs, endMs: engineEndMs };
  }
  return { path, startMs: nowMs, endMs: nowMs + (pathLength(path) / WALK_SPEED) * 1000 };
}

/**
 * A walk from `from` to `to` that starts at `startMs` and goes at the walk speed, or that ends at `endMs` when it is
 * given: a walk of the presentation (a plugin walk) with fixed times, so its place is a function of the simulation
 * time. Null when the two places are the same.
 */
export function timedWalk(
  from: FloorPoint,
  to: FloorPoint,
  obstacles: readonly FloorRect[],
  startMs: number,
  endMs: number | null = null,
): Walk | null {
  if (length(from, to) < 0.05) return null;
  const path = planPath(from, to, obstacles);
  const natural = startMs + (pathLength(path) / WALK_SPEED) * 1000;
  return { path, startMs, endMs: endMs !== null && endMs > startMs ? endMs : natural };
}

/** The place of a walk at a simulation time, its heading and the walk speed (metres per second). */
export function walkState(
  walk: Walk,
  nowMs: number,
): { at: FloorPoint; heading: number; speed: number; done: boolean } {
  const span = Math.max(1, walk.endMs - walk.startMs);
  const share = (nowMs - walk.startMs) / span;
  const { at, heading } = pointAt(walk.path, share);
  return { at, heading, speed: (pathLength(walk.path) / span) * 1000, done: share >= 1 };
}
