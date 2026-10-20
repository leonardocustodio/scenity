// SPDX-License-Identifier: Apache-2.0
/**
 * The collider descriptions of the physics plugin: a Rapier `ColliderDesc` from a `physics.collider` value,
 * the `shape` component of the entity and the world scale. The sizes follow the `shape` component: a full size, not a
 * half size. A plane becomes a thin box under the plane, so its top face is the plane.
 */
import type { ColliderDesc } from "@dimforge/rapier3d-deterministic-compat";
import type { Vec3 } from "@scenity/scene/math";
import { COLLIDER_DEFAULTS, type ColliderShape, type ColliderValue } from "../components";
import { RAPIER } from "../rapier";

/** The thickness of the box under a plane, in metres. */
export const PLANE_THICKNESS = 0.1;
/** The smallest half size of a collider, in metres: Rapier refuses a size of 0. */
const MIN_HALF = 0.0005;

/** The fields of the `shape` component that a `bounds` collider reads. */
interface ShapeLike {
  readonly kind?: unknown;
  readonly size?: unknown;
}

function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === "number");
}

function half(value: number): number {
  return Math.max(MIN_HALF, Math.abs(value) / 2);
}

/** A shape kind, a full size and a centre offset in the frame of the entity (before the scale). */
interface Solid {
  readonly kind: Exclude<ColliderShape, "bounds">;
  readonly size: Vec3;
  readonly centre: Vec3;
}

/** The solid of a `bounds` collider: the box, sphere, cylinder or plane of the `shape` component. */
function boundsSolid(shape: ShapeLike | undefined): Solid {
  const size = isVec3(shape?.size) ? shape.size : COLLIDER_DEFAULTS.size;
  switch (shape?.kind) {
    case "sphere":
      return { kind: "sphere", size, centre: [0, 0, 0] };
    case "cylinder":
      return { kind: "cylinder", size, centre: [0, 0, 0] };
    case "plane":
      return { kind: "box", size: [size[0], PLANE_THICKNESS, size[2]], centre: [0, -PLANE_THICKNESS / 2, 0] };
    default:
      return { kind: "box", size, centre: [0, 0, 0] };
  }
}

/** The solid of a collider value. */
function solidOf(value: ColliderValue, shape: ShapeLike | undefined): Solid {
  const kind = value.shape ?? COLLIDER_DEFAULTS.shape;
  if (kind === "bounds") return boundsSolid(shape);
  return { kind, size: value.size ?? COLLIDER_DEFAULTS.size, centre: [0, 0, 0] };
}

/** The Rapier description of a solid, with the world scale. A round solid takes the largest scale of its axes. */
function describe(solid: Solid, scale: Vec3): ColliderDesc {
  const [sx, sy, sz] = scale.map(Math.abs) as unknown as Vec3;
  const [x, y, z] = solid.size;
  switch (solid.kind) {
    case "sphere":
      return RAPIER.ColliderDesc.ball(half(x * Math.max(sx, sy, sz)));
    case "capsule": {
      const radius = half(x * Math.max(sx, sz));
      return RAPIER.ColliderDesc.capsule(Math.max(MIN_HALF, half(y * sy) - radius), radius);
    }
    case "cylinder":
      return RAPIER.ColliderDesc.cylinder(half(y * sy), half(x * Math.max(sx, sz)));
    default:
      return RAPIER.ColliderDesc.cuboid(half(x * sx), half(y * sy), half(z * sz));
  }
}

/**
 * The collider description of an entity: the shape, the material values and the local centre (the offset of the value
 * and the centre of the solid, with the scale). `mass` replaces the density when it is given.
 */
export function colliderDesc(
  value: ColliderValue,
  shape: ShapeLike | undefined,
  scale: Vec3,
  mass: number | undefined,
): ColliderDesc {
  const solid = solidOf(value, shape);
  const offset = value.offset ?? COLLIDER_DEFAULTS.offset;
  const desc = describe(solid, scale)
    .setTranslation(
      (offset[0] + solid.centre[0]) * scale[0],
      (offset[1] + solid.centre[1]) * scale[1],
      (offset[2] + solid.centre[2]) * scale[2],
    )
    .setFriction(value.friction ?? COLLIDER_DEFAULTS.friction)
    .setRestitution(value.restitution ?? COLLIDER_DEFAULTS.restitution)
    .setSensor(value.sensor ?? COLLIDER_DEFAULTS.sensor);
  return mass === undefined ? desc.setDensity(value.density ?? COLLIDER_DEFAULTS.density) : desc.setMass(mass);
}

/**
 * The gap between the capsule of a character and the other colliders, in metres: the offset of the character
 * controller. A capsule that starts at this gap or nearer falls through the floor, so a character starts one more gap
 * higher (world.ts).
 */
export const CONTROLLER_OFFSET = 0.01;

/**
 * The collider of a character: a capsule one gap over the origin of the body. Thus a character that rests on a floor
 * has its body origin, the base of the entity, on the floor.
 */
export function characterDesc(radius: number, height: number): ColliderDesc {
  const halfHeight = Math.max(MIN_HALF, height / 2 - radius);
  const capsule = RAPIER.ColliderDesc.capsule(halfHeight, Math.max(MIN_HALF, radius));
  return capsule.setTranslation(0, height / 2 + CONTROLLER_OFFSET, 0);
}
