// SPDX-License-Identifier: Apache-2.0
/**
 * The queries of the physics world for other systems: ray casts. The physics system of a core registers its
 * queries under the core (the `core` of the system factory). A system of another plugin keeps the `core` of
 * its factory. In its update, it gets the queries with `physicsQueries(core)` and casts rays. The physics system has
 * the order `PHYSICS_ORDER`, so a system with a higher order sees the world after the step of the frame.
 *
 * This module does not import Rapier: a plugin that casts rays does not get a copy of the WASM.
 */
import type { Vec3 } from "@scenity/scene/math";

/** The order of the physics system: it runs before the systems with the default order 0. */
export const PHYSICS_ORDER = -100;

/** One hit of a ray cast. */
export interface RayHit {
  /** The entity of the collider that the ray hits. */
  readonly entity: string;
  /** The distance from the origin to the hit point, in metres. */
  readonly distance: number;
  readonly point: Vec3;
  /** The normal of the collider surface at the hit point (unit length). */
  readonly normal: Vec3;
}

export interface RayOptions {
  /** The ray does not hit the colliders of this entity (for example the entity that casts the ray). */
  readonly exclude?: string;
  /** True: the ray also hits sensors. Default: false. */
  readonly sensors?: boolean;
}

export interface PhysicsQueries {
  /**
   * The first hit of a ray from `origin` along `direction` (any length but 0), at most `maxDistance` metres away, or
   * null. The ray sees the colliders at the last physics step: before the first step it sees none.
   */
  castRay(origin: Vec3, direction: Vec3, maxDistance: number, options?: RayOptions): RayHit | null;
}

/** The key of the queries when a runner has no core (a test of a plugin). */
const NO_CORE = {};
const registry = new WeakMap<object, PhysicsQueries>();

function keyOf(core: unknown): object {
  return typeof core === "object" && core !== null ? core : NO_CORE;
}

/** Register the queries of the physics system of a core. The physics system calls it in its factory. */
export function registerPhysicsQueries(core: unknown, queries: PhysicsQueries): void {
  registry.set(keyOf(core), queries);
}

/** The queries of the physics world of a core, or undefined when the core has no physics system. */
export function physicsQueries(core: unknown): PhysicsQueries | undefined {
  return registry.get(keyOf(core));
}
