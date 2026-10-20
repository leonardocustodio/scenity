// SPDX-License-Identifier: Apache-2.0
/**
 * The math of the placement helpers over the world boxes of the entities (the inspect report of the core). It gives
 * the move of each entity, as a vector in the world, for align and spread, drop to the floor, put on, against, near
 * and a free place. It also gives the turn that faces a target. A box is the box of an entity with its subtree.
 * Pure functions, no DOM.
 */
export type Vec3 = readonly [number, number, number];

/** A world box. */
export interface Box {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** An entity with its world box. */
export interface Placed {
  readonly id: string;
  readonly box: Box;
}

export type Axis = "x" | "y" | "z";
export type Edge = "min" | "centre" | "max";
export type Side = "+x" | "-x" | "+z" | "-z";

const INDEX: Readonly<Record<Axis, 0 | 1 | 2>> = { x: 0, y: 1, z: 2 };
/** The smallest depth that counts as an overlap of two boxes (metres). */
export const OVERLAP_EPSILON = 0.001;

const round = (value: number): number => Math.round(value * 1e4) / 1e4;
const vec = (x: number, y: number, z: number): Vec3 => [round(x), round(y), round(z)];

export function centreOf(box: Box): Vec3 {
  return [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
}

/** The value of an edge of a box on an axis. */
function edgeOf(box: Box, axis: Axis, edge: Edge): number {
  const at = INDEX[axis];
  if (edge === "min") return box.min[at];
  if (edge === "max") return box.max[at];
  return (box.min[at] + box.max[at]) / 2;
}

/** A move along one axis. */
function along(axis: Axis, value: number): Vec3 {
  return vec(axis === "x" ? value : 0, axis === "y" ? value : 0, axis === "z" ? value : 0);
}

/** Align the boxes to the edge of the first one on an axis; the first one stays. */
export function alignMoves(items: readonly Placed[], axis: Axis, edge: Edge): Map<string, Vec3> {
  const [first, ...rest] = items;
  const out = new Map<string, Vec3>();
  if (first === undefined) return out;
  const target = edgeOf(first.box, axis, edge);
  for (const item of rest) out.set(item.id, along(axis, target - edgeOf(item.box, axis, edge)));
  return out;
}

/** Spread the boxes on an axis with equal gaps between them; the first and the last box (in their order) stay. */
export function spreadMoves(items: readonly Placed[], axis: Axis): Map<string, Vec3> {
  const at = INDEX[axis];
  const sorted = [...items].sort((a, b) => centreOf(a.box)[at] - centreOf(b.box)[at]);
  const out = new Map<string, Vec3>();
  const first = sorted[0];
  const last = sorted.at(-1);
  if (first === undefined || last === undefined || sorted.length < 3) return out;
  const sizes = sorted.map((item) => item.box.max[at] - item.box.min[at]);
  const room = last.box.max[at] - first.box.min[at] - sizes.reduce((sum, size) => sum + size, 0);
  const gap = room / (sorted.length - 1);
  let cursor = first.box.max[at] + gap;
  sorted.slice(1, -1).forEach((item, index) => {
    out.set(item.id, along(axis, cursor - item.box.min[at]));
    cursor += (sizes[index + 1] ?? 0) + gap;
  });
  return out;
}

/** True when the boxes overlap on the floor plan (x and z) by more than the epsilon. */
function overlapsPlan(a: Box, b: Box): boolean {
  return (
    Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]) > OVERLAP_EPSILON &&
    Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]) > OVERLAP_EPSILON
  );
}

/** True when two boxes go into each other by more than the epsilon on each axis. */
export function overlaps(a: Box, b: Box): boolean {
  return [0, 1, 2].every(
    (at) => Math.min(a.max[at] ?? 0, b.max[at] ?? 0) - Math.max(a.min[at] ?? 0, b.min[at] ?? 0) > OVERLAP_EPSILON,
  );
}

/** The box moved by a vector. */
export function moved(box: Box, by: Vec3): Box {
  return {
    min: vec(box.min[0] + by[0], box.min[1] + by[1], box.min[2] + by[2]),
    max: vec(box.max[0] + by[0], box.max[1] + by[1], box.max[2] + by[2]),
  };
}

/**
 * Drop a box to the surface under it: the highest top of another box under its floor plan that is not above its
 * middle, else the height 0.
 */
export function floorMove(box: Box, others: readonly Box[]): Vec3 {
  const middle = (box.min[1] + box.max[1]) / 2;
  const tops = others
    .filter((other) => overlapsPlan(box, other) && other.max[1] <= middle)
    .map((other) => other.max[1]);
  const floor = tops.length === 0 ? 0 : Math.max(...tops);
  return vec(0, floor - box.min[1], 0);
}

/** Put a box on the top of a target, in the middle of its top. */
export function onMove(box: Box, target: Box): Vec3 {
  const [cx, , cz] = centreOf(box);
  const [tx, , tz] = centreOf(target);
  return vec(tx - cx, target.max[1] - box.min[1], tz - cz);
}

/** Put a box against a side of a target: it touches the side, in the middle of it, on the floor of the target. */
export function againstMove(box: Box, target: Box, side: Side): Vec3 {
  const [cx, , cz] = centreOf(box);
  const [tx, , tz] = centreOf(target);
  const dy = target.min[1] - box.min[1];
  if (side === "+x") return vec(target.max[0] - box.min[0], dy, tz - cz);
  if (side === "-x") return vec(target.min[0] - box.max[0], dy, tz - cz);
  if (side === "+z") return vec(tx - cx, dy, target.max[2] - box.min[2]);
  return vec(tx - cx, dy, target.min[2] - box.max[2]);
}

/**
 * Put a box near a target: in the direction of `angle` (degrees about the up axis; 0 is +Z, 90 is +X), with a `gap`
 * (metres) between the two boxes, on the floor of the target.
 */
export function nearMove(box: Box, target: Box, angle: number, gap: number): Vec3 {
  const turn = (angle * Math.PI) / 180;
  const way: Vec3 = [Math.sin(turn), 0, Math.cos(turn)];
  const half = (b: Box): [number, number] => [(b.max[0] - b.min[0]) / 2, (b.max[2] - b.min[2]) / 2];
  const reach = (b: Box): number => {
    const [hx, hz] = half(b);
    // The distance from the middle to the side of the box in the direction: the box edge that the ray meets first.
    const sx = Math.abs(way[0]) < 1e-9 ? Infinity : hx / Math.abs(way[0]);
    const sz = Math.abs(way[2]) < 1e-9 ? Infinity : hz / Math.abs(way[2]);
    return Math.min(sx, sz);
  };
  const distance = reach(target) + reach(box) + gap;
  const [cx, , cz] = centreOf(box);
  const [tx, , tz] = centreOf(target);
  return vec(tx + way[0] * distance - cx, target.min[1] - box.min[1], tz + way[2] * distance - cz);
}

/** The turn about the up axis (degrees) of an entity at `from` that looks along -Z to face `to`. */
export function facingYaw(from: Vec3, to: Vec3): number {
  return round((Math.atan2(-(to[0] - from[0]), -(to[2] - from[2])) * 180) / Math.PI);
}

/**
 * The move of a box to a free place on the floor near a point: the first place of a spiral of steps round the point
 * where the box, on the floor, goes into no other box. Null when no place of the search is free.
 */
export function freeMove(box: Box, others: readonly Box[], near: Vec3, step = 0.25, rings = 40): Vec3 | null {
  const [cx, , cz] = centreOf(box);
  const base = vec(0, -box.min[1], 0);
  const tries: [number, number][] = [[0, 0]];
  for (let ring = 1; ring <= rings; ring += 1) {
    for (let x = -ring; x <= ring; x += 1)
      for (let z = -ring; z <= ring; z += 1) if (Math.max(Math.abs(x), Math.abs(z)) === ring) tries.push([x, z]);
  }
  for (const [x, z] of tries) {
    const by = vec(near[0] + x * step - cx, base[1], near[2] + z * step - cz);
    const placed = moved(box, by);
    if (!others.some((other) => overlaps(placed, other))) return by;
  }
  return null;
}
