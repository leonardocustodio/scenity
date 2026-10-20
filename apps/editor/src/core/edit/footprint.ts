// SPDX-License-Identifier: Apache-2.0
/**
 * The floor box of a prop at a place, and the overlap test of a floor box with a floor rectangle. The warnings of a
 * place, the snap and the place words use them.
 *
 * This module has only pure functions and no Vue import.
 */
import type { FloorRect, Vec3 } from "@scenity/character";
import type { PropPlace } from "./placeDrag";

/** The box of a prop in the frame of its place (PickResult.local). */
export interface LocalBox {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** A point on the floor (x, z). */
export type Point = readonly [number, number];

/** The 4 corners (x, z) of the floor box of a prop at a place. */
export function footprint(local: LocalBox, place: PropPlace): Point[] {
  const cos = Math.cos(place.yaw);
  const sin = Math.sin(place.yaw);
  const corners: Point[] = [
    [local.min[0], local.min[2]],
    [local.max[0], local.min[2]],
    [local.max[0], local.max[2]],
    [local.min[0], local.max[2]],
  ];
  // A turn around +y by yaw: x' = x cos + z sin, z' = −x sin + z cos.
  return corners.map(([x, z]) => [place.at[0] + x * cos + z * sin, place.at[2] - x * sin + z * cos] as const);
}

/** True when a convex polygon and a floor rectangle overlap by more than `margin` metres (separating axes). */
export function overlaps(polygon: readonly Point[], rect: FloorRect, margin = 0.005): boolean {
  const square: Point[] = [
    [rect.minX, rect.minZ],
    [rect.maxX, rect.minZ],
    [rect.maxX, rect.maxZ],
    [rect.minX, rect.maxZ],
  ];
  const axes: Point[] = [
    [1, 0],
    [0, 1],
  ];
  polygon.forEach((point, index) => {
    const next = polygon[(index + 1) % polygon.length] ?? point;
    axes.push([-(next[1] - point[1]), next[0] - point[0]]);
  });
  for (const [ax, az] of axes) {
    const length = Math.hypot(ax, az);
    if (length === 0) continue;
    const project = (points: readonly Point[]): [number, number] => {
      const values = points.map(([x, z]) => (x * ax + z * az) / length);
      return [Math.min(...values), Math.max(...values)];
    };
    const [a0, a1] = project(polygon);
    const [b0, b1] = project(square);
    if (Math.min(a1, b1) - Math.max(a0, b0) <= margin) return false;
  }
  return true;
}
