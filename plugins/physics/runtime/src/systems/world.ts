// SPDX-License-Identifier: Apache-2.0
/**
 * The build of the physics world from a scene. The build reads the entities in the sort order of their IDs,
 * so the same scene gives the same world and the same handles. Each entity with a `physics.rigidBody`, a
 * `physics.collider` or a `physics.character` component gets one body. An entity with only a collider gets a fixed
 * body. A body starts at the world transform of its entity. A child entity takes the transforms of its parents.
 */
import type { World } from "@dimforge/rapier3d-deterministic-compat";
import type { Vec3 } from "@scenity/scene/math";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { worldTransform } from "@scenity/scene/world";
import {
  CHARACTER_DEFAULTS,
  RIGID_BODY_DEFAULTS,
  characterSchema,
  colliderSchema,
  rigidBodySchema,
  type CharacterValue,
  type ColliderValue,
  type RigidBodyValue,
} from "../components";
import { RAPIER } from "../rapier";
import { CONTROLLER_OFFSET, characterDesc, colliderDesc } from "./shapes";

/** The gravity of the world in m/s². */
export const GRAVITY: Vec3 = [0, -9.81, 0];
/** The fixed step of the world in seconds: the step of the systems. */
export const STEP_SECONDS = 1 / 60;

/** The kind of a body: a character is a kinematic body that the character controller moves. */
export type BodyKind = "dynamic" | "fixed" | "kinematic" | "character";

/** One body of the world: plain JSON, so it is part of the system memory. */
export interface BodyEntry {
  readonly kind: BodyKind;
  /** The Rapier handle of the body. */
  readonly body: number;
  /** The Rapier handle of the collider, or null for a body with no collider. */
  readonly collider: number | null;
  readonly parent: string | null;
}

/** The character values with the defaults. */
export type CharacterSettings = { readonly [K in keyof CharacterValue]-?: NonNullable<CharacterValue[K]> };

/** A new world, with its bodies by entity ID, in the sort order of the IDs. */
export interface BuiltWorld {
  readonly world: World;
  readonly bodies: Readonly<Record<string, BodyEntry>>;
}

const DEG = Math.PI / 180;

/** The parsed value of a component, or undefined when the entity has none or the value is not valid. */
function parse<T>(
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
  value: unknown,
): T | undefined {
  if (value === undefined) return undefined;
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** The character settings of a value, with the defaults. */
export function characterSettings(value: CharacterValue): CharacterSettings {
  return {
    ...CHARACTER_DEFAULTS,
    ...value,
    actions: { ...CHARACTER_DEFAULTS.actions, ...value.actions },
  } as CharacterSettings;
}

/** The physics values of an entity, or undefined when it has none. */
export interface PhysicsValues {
  readonly body?: RigidBodyValue;
  readonly collider?: ColliderValue;
  readonly character?: CharacterValue;
}

/** The physics values of the components of an entity. */
export function physicsValues(components: Readonly<Record<string, unknown>>): PhysicsValues | undefined {
  const body = parse<RigidBodyValue>(rigidBodySchema, components["physics.rigidBody"]);
  const collider = parse<ColliderValue>(colliderSchema, components["physics.collider"]);
  const character = parse<CharacterValue>(characterSchema, components["physics.character"]);
  if (body === undefined && collider === undefined && character === undefined) return undefined;
  return {
    ...(body === undefined ? {} : { body }),
    ...(collider === undefined ? {} : { collider }),
    ...(character === undefined ? {} : { character }),
  };
}

/** The kind of the body of an entity. */
function kindOf(values: PhysicsValues): BodyKind {
  if (values.character !== undefined) return "character";
  return values.body?.type ?? (values.body === undefined ? "fixed" : RIGID_BODY_DEFAULTS.type);
}

/** Add the body and the collider of one entity to the world. */
function addBody(world: World, scene: SceneDocument, id: string, values: PhysicsValues): BodyEntry | undefined {
  const entity = scene.entities[id];
  const place = worldTransform(scene, id);
  if (entity === undefined || place === undefined) return undefined;
  const kind = kindOf(values);
  const [px, py, pz] = place.position;
  const [rx, ry, rz, rw] = place.rotation;
  const desc =
    kind === "dynamic"
      ? RAPIER.RigidBodyDesc.dynamic()
      : kind === "fixed"
        ? RAPIER.RigidBodyDesc.fixed()
        : RAPIER.RigidBodyDesc.kinematicPositionBased();
  // A character capsule stands up: the facing of a character is a value of the system memory, not of the body.
  const rotation = kind === "character" ? { x: 0, y: 0, z: 0, w: 1 } : { x: rx, y: ry, z: rz, w: rw };
  // A character starts one controller gap over its base (shapes.ts).
  desc.setTranslation(px, kind === "character" ? py + CONTROLLER_OFFSET : py, pz).setRotation(rotation);
  const body = values.body ?? {};
  if (kind === "dynamic") {
    const [vx, vy, vz] = body.velocity ?? RIGID_BODY_DEFAULTS.velocity;
    const [ax, ay, az] = body.angularVelocity ?? RIGID_BODY_DEFAULTS.angularVelocity;
    desc
      .setLinvel(vx, vy, vz)
      .setAngvel({ x: ax * DEG, y: ay * DEG, z: az * DEG })
      .setLinearDamping(body.linearDamping ?? RIGID_BODY_DEFAULTS.linearDamping)
      .setAngularDamping(body.angularDamping ?? RIGID_BODY_DEFAULTS.angularDamping)
      .setGravityScale(body.gravityScale ?? RIGID_BODY_DEFAULTS.gravityScale)
      .setCcdEnabled(body.ccd ?? RIGID_BODY_DEFAULTS.ccd);
    if (values.collider === undefined && body.mass !== undefined) desc.setAdditionalMass(body.mass);
  }
  const rigid = world.createRigidBody(desc);
  let collider: number | null = null;
  if (kind === "character") {
    const settings = characterSettings(values.character ?? {});
    collider = world.createCollider(characterDesc(settings.radius, settings.height), rigid).handle;
  } else if (values.collider !== undefined) {
    const shape = entity.components.shape as Readonly<Record<string, unknown>> | undefined;
    const mass = kind === "dynamic" ? body.mass : undefined;
    collider = world.createCollider(colliderDesc(values.collider, shape, place.scale, mass), rigid).handle;
  }
  return { kind, body: rigid.handle, collider, parent: entity.parent };
}

/** Build the world of a scene. */
export function buildWorld(scene: SceneDocument): BuiltWorld {
  const world = new RAPIER.World({ x: GRAVITY[0], y: GRAVITY[1], z: GRAVITY[2] });
  world.timestep = STEP_SECONDS;
  const bodies: Record<string, BodyEntry> = {};
  for (const id of Object.keys(scene.entities).sort()) {
    const values = physicsValues(scene.entities[id]?.components ?? {});
    if (values === undefined) continue;
    const entry = addBody(world, scene, id, values);
    if (entry !== undefined) bodies[id] = entry;
  }
  return { world, bodies };
}
