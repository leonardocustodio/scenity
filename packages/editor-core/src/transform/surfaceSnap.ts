// SPDX-License-Identifier: Apache-2.0
/**
 * The snap of a free move to surfaces and sockets. The rules are the rules of the lab snap
 * (apps/editor/src/core/editor/snapPlace.ts), with the surfaces from the world bounds of the entities in place of the
 * room kit:
 *
 * - A **surface** is the top of the box of an entity. A free move puts the entity on the nearest surface on the ray of
 *   the pointer that has the entity origin on it. The base of the entity (the bottom of its box) goes to the surface
 *   height. An entity that starts within 2 cm of that height keeps its height. The grid stays for the place on the
 *   surface. The lowest surface (the ground) counts only for an entity that starts on a surface. An entity in the air
 *   stays at its height above the ground, but a raised surface under the pointer takes it.
 * - Then the nearest **socket** of another entity within 8 cm changes the place. The nearest socket of the moved
 *   entity meets it, or the origin of an entity with no socket goes on it.
 *
 * Pure functions: no DOM, no state between calls.
 */
import { vadd, vsub, type Vec3 } from "@scenity/scene/math";
import { roundNumber } from "@scenity/scene/canonical";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import { socketWorld } from "@scenity/scene/world";
import { levelHit, rayDistance, type Ray } from "./handleMath";
import { snapStep } from "./snaps";

/** The radius of a snap to a socket (metres). */
export const SNAP_RADIUS = 0.08;
/** An entity within this height of a surface sits on it at its own height (metres). */
export const SURFACE_KEEP = 0.02;
/** A top smaller than this on a side is no surface (a wall plane seen from above), metres. */
export const MIN_SURFACE = 0.01;

/** A box with the axes of the world. */
export interface WorldBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** The box of an entity for the surfaces: the box of its own meshes, without its child entities. */
export interface BoxedEntity {
  readonly id: string;
  readonly box: WorldBox | null;
}

/** The top of the box of an entity: a level rectangle at the height `y`. */
export interface SurfaceRect {
  readonly id: string;
  readonly y: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** The surfaces of the entities: the top of each box, without the entities of `skip` (the moved entities). */
export function surfacesOf(entities: readonly BoxedEntity[], skip: ReadonlySet<string>): SurfaceRect[] {
  const out: SurfaceRect[] = [];
  for (const { id, box } of entities) {
    if (box === null || skip.has(id)) continue;
    if (box.max[0] - box.min[0] < MIN_SURFACE || box.max[2] - box.min[2] < MIN_SURFACE) continue;
    out.push({ id, y: box.max[1], minX: box.min[0], maxX: box.max[0], minZ: box.min[2], maxZ: box.max[2] });
  }
  return out;
}

/** True when the point (x, z) is on the rectangle of a surface. */
export function onSurface(surface: SurfaceRect, point: Vec3): boolean {
  return point[0] >= surface.minX && point[0] <= surface.maxX && point[2] >= surface.minZ && point[2] <= surface.maxZ;
}

/** The base height on a surface: the surface height, or the base itself within SURFACE_KEEP. */
export function restHeight(surface: SurfaceRect, base: number): number {
  return Math.abs(base - surface.y) <= SURFACE_KEEP ? base : surface.y;
}

/** The start of a free move: the world origin of the entity, the bottom of its box, and the world point of the press. */
export interface FreeStart {
  readonly origin: Vec3;
  readonly base: number;
  readonly grab: Vec3;
}

/** A free move on a surface: the world origin and the surface. */
export interface SurfaceMove {
  readonly origin: Vec3;
  readonly surface: SurfaceRect;
}

/** The nearest surface on the ray of the pointer with the entity origin on it, or null. `grid` 0: no grid. */
export function surfaceMove(
  start: FreeStart,
  ray: Ray,
  surfaces: readonly SurfaceRect[],
  grid: number,
): SurfaceMove | null {
  const ground = Math.min(...surfaces.map((surface) => surface.y));
  const resting = surfaces.some(
    (surface) => onSurface(surface, start.origin) && Math.abs(start.base - surface.y) <= SURFACE_KEEP,
  );
  let best: { origin: Vec3; surface: SurfaceRect; t: number } | null = null;
  for (const surface of surfaces) {
    if (!resting && surface.y <= ground + 1e-6) continue;
    const height = restHeight(surface, start.base);
    const lift = height - start.base;
    // The grabbed point moves up or down with the entity. Thus it stays under the pointer.
    const hit = levelHit(ray, start.grab[1] + lift);
    if (hit === null) continue;
    const t = rayDistance(ray, hit);
    const origin: Vec3 = [
      snapStep(start.origin[0] + hit[0] - start.grab[0], grid),
      roundNumber(start.origin[1] + lift),
      snapStep(start.origin[2] + hit[2] - start.grab[2], grid),
    ];
    if (!onSurface(surface, origin) || (best !== null && t >= best.t)) continue;
    best = { origin, surface, t };
  }
  return best === null ? null : { origin: best.origin, surface: best.surface };
}

/** A socket in the world: its reference `entity:<id>#<name>`, its entity and its world point. */
export interface SocketPoint {
  readonly ref: string;
  readonly owner: string;
  readonly at: Vec3;
}

/** The world sockets of the entities of a document (the `socket` component), in the order of the entity IDs. */
export function socketPoints(doc: EntityDocument, only?: ReadonlySet<string>): SocketPoint[] {
  const out: SocketPoint[] = [];
  for (const id of Object.keys(doc.entities).sort()) {
    if (only !== undefined && !only.has(id)) continue;
    const socket = doc.entities[id]?.components.socket as { points?: Record<string, unknown> } | undefined;
    for (const name of Object.keys(socket?.points ?? {}).sort()) {
      const ref = `entity:${id}#${name}`;
      const world = socketWorld(doc, ref);
      if (world !== undefined) out.push({ ref, owner: id, at: world.position });
    }
  }
  return out;
}

/** A free move at a socket: the world origin and the socket that it meets. */
export interface SocketMove {
  readonly origin: Vec3;
  readonly target: SocketPoint;
}

/**
 * The nearest socket within the radius of a free move, or null. `own` are the offsets of the sockets of the moved
 * entity from its origin (empty: the origin itself meets the socket). `targets` must not hold the moved entities.
 */
export function socketMove(
  origin: Vec3,
  own: readonly Vec3[],
  targets: readonly SocketPoint[],
  radius = SNAP_RADIUS,
): SocketMove | null {
  const points = own.length === 0 ? [[0, 0, 0] as Vec3] : own;
  let best: { origin: Vec3; target: SocketPoint; distance: number } | null = null;
  for (const target of targets) {
    for (const offset of points) {
      const gap = vsub(target.at, vadd(origin, offset));
      const distance = Math.hypot(...gap);
      if (distance > radius || (best !== null && distance >= best.distance)) continue;
      const moved = vadd(origin, gap);
      best = { origin: [roundNumber(moved[0]), roundNumber(moved[1]), roundNumber(moved[2])], target, distance };
    }
  }
  return best === null ? null : { origin: best.origin, target: best.target };
}

/** The level move of an entity with no surface under the pointer: the plane at the grab height, x and z on the grid. */
export function levelMove(start: FreeStart, ray: Ray, grid: number): Vec3 | null {
  const hit = levelHit(ray, start.grab[1]);
  if (hit === null) return null;
  return [
    snapStep(start.origin[0] + hit[0] - start.grab[0], grid),
    roundNumber(start.origin[1]),
    snapStep(start.origin[2] + hit[2] - start.grab[2], grid),
  ];
}

/** What a free move snapped to: a surface, a socket, or nothing (the level plane). */
export interface FreeMove {
  readonly origin: Vec3;
  readonly surface: SurfaceRect | null;
  readonly socket: SocketPoint | null;
}

/** The snap parts of a free move. */
export interface FreeSnap {
  readonly grid: number;
  /** The surface and socket snap. False: only the level plane and the grid. */
  readonly surface: boolean;
  readonly surfaces: readonly SurfaceRect[];
  readonly sockets: readonly SocketPoint[];
  readonly own: readonly Vec3[];
}

/** The world origin of a free move with the snaps: a surface, then a socket, else the level plane. Null: no hit. */
export function freeMove(start: FreeStart, ray: Ray, snap: FreeSnap): FreeMove | null {
  const sits = snap.surface ? surfaceMove(start, ray, snap.surfaces, snap.grid) : null;
  const base = sits?.origin ?? levelMove(start, ray, snap.grid);
  if (base === null) return null;
  const near = snap.surface ? socketMove(base, snap.own, snap.sockets) : null;
  return { origin: near?.origin ?? base, surface: sits?.surface ?? null, socket: near?.target ?? null };
}
