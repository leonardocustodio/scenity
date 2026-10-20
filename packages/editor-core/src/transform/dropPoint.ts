// SPDX-License-Identifier: Apache-2.0
/**
 * The place of a drop of an asset into the viewport: the point on the surface under the pointer. The function uses the
 * surfaces of the free move (surfaceSnap.ts, the tops of the own boxes of the entities) and the pick of the runtime.
 * The rule:
 *
 * - A surface top under the pointer that is in front of the pick hit (or with no hit) takes the drop. This is the
 *   nearest surface top on the ray of the pointer. The point is on the top of the box, so the base of the new model
 *   sits on it.
 * - Else the pick hit point takes the drop (for example a side of a model, or a mesh with no surface box).
 * - Else the ground plane (y = 0) takes it, or nothing when the ray does not meet it in front.
 *
 * Pure functions: no DOM.
 */
import { roundNumber } from "@scenity/scene/canonical";
import type { Vec3 } from "@scenity/scene/math";
import { levelHit, rayDistance, type Ray } from "./handleMath";
import { onSurface, type SurfaceRect } from "./surfaceSnap";

/** A pick hit of the runtime: the entity and the world point. */
export interface AssetDropHit {
  readonly entity: string;
  readonly point: readonly [number, number, number];
}

/** The place of a drop: the world point and the entity of its surface (null: the ground plane). */
export interface AssetDropPlace {
  readonly point: Vec3;
  readonly surface: string | null;
}

/** A tolerance of the ray distances (metres). A surface top at the hit point counts as in front of it. */
const FRONT = 0.02;

function rounded(point: readonly number[]): Vec3 {
  return [roundNumber(point[0] ?? 0), roundNumber(point[1] ?? 0), roundNumber(point[2] ?? 0)];
}

/** The place of a drop for the ray of the pointer, the surfaces and the pick hit (null: no hit). */
export function assetDropPoint(
  ray: Ray,
  surfaces: readonly SurfaceRect[],
  hit: AssetDropHit | null,
): AssetDropPlace | null {
  const limit = hit === null ? Number.POSITIVE_INFINITY : rayDistance(ray, [...hit.point]) + FRONT;
  let best: { point: Vec3; surface: string; t: number } | null = null;
  for (const surface of surfaces) {
    const point = levelHit(ray, surface.y);
    if (point === null || !onSurface(surface, point)) continue;
    const t = rayDistance(ray, point);
    if (t > limit || (best !== null && t >= best.t)) continue;
    best = { point: [point[0], surface.y, point[2]], surface: surface.id, t };
  }
  if (best !== null) return { point: rounded(best.point), surface: best.surface };
  if (hit !== null) return { point: rounded(hit.point), surface: hit.entity };
  const ground = levelHit(ray, 0);
  return ground === null ? null : { point: rounded(ground), surface: null };
}
