// SPDX-License-Identifier: Apache-2.0
/**
 * The components of the physics plugin: `physics.collider`, `physics.rigidBody` and `physics.character`. The
 * editor has no code for them: the inspector makes its widgets from the schemas and the hints. The units are metres,
 * kilograms, seconds and degrees. The defaults are the values of `*_DEFAULTS`; the system applies them.
 */
import { z } from "zod";
import { defineComponent } from "@scenity/scene/components";
import { vec3Schema } from "@scenity/scene/schema/common";
import { ACTION_PATTERN } from "@scenity/scene/sequence";

/** The collider shapes. `bounds` takes the box, sphere, cylinder or plane of the `shape` component of the entity. */
export const COLLIDER_SHAPES = ["bounds", "box", "sphere", "capsule", "cylinder"] as const;
export type ColliderShape = (typeof COLLIDER_SHAPES)[number];

export const colliderSchema = z.strictObject({
  shape: z.enum(COLLIDER_SHAPES).optional(),
  /**
   * The size in metres, as in the `shape` component: the full width, height and depth of a box; X is the diameter of
   * a sphere; X is the diameter and Y the full height of a capsule and a cylinder. `bounds` does not read it.
   */
  size: vec3Schema.optional(),
  /** The centre of the collider in the frame of the entity. */
  offset: vec3Schema.optional(),
  friction: z.number().min(0).max(10).optional(),
  restitution: z.number().min(0).max(1).optional(),
  /** The density in kg per cubic metre. A `mass` of the rigid body replaces it. */
  density: z.number().min(0).max(100000).optional(),
  /** A sensor finds the overlaps but does not push other colliders. */
  sensor: z.boolean().optional(),
});
export type ColliderValue = z.infer<typeof colliderSchema>;

export const COLLIDER_DEFAULTS = {
  shape: "bounds",
  size: [1, 1, 1],
  offset: [0, 0, 0],
  friction: 0.5,
  restitution: 0,
  density: 1000,
  sensor: false,
} as const satisfies Required<ColliderValue>;

export const colliderComponent = defineComponent({
  id: "physics.collider",
  schema: colliderSchema,
  defaults: COLLIDER_DEFAULTS,
  editor: {
    label: "Collider",
    group: "Physics",
    fields: {
      shape: { widget: { kind: "enum", options: COLLIDER_SHAPES }, label: "Shape" },
      size: { widget: { kind: "vector3", unit: "m", step: 0.01 }, label: "Size" },
      offset: { widget: { kind: "vector3", unit: "m", step: 0.01 }, label: "Offset" },
      friction: { widget: { kind: "number", min: 0, max: 10, step: 0.05 }, label: "Friction" },
      restitution: { widget: { kind: "number", min: 0, max: 1, step: 0.05 }, label: "Restitution" },
      density: { widget: { kind: "number", unit: "kg/m³", min: 0, max: 100000, step: 10 }, label: "Density" },
      sensor: { widget: { kind: "boolean" }, label: "Sensor" },
    },
  },
});

/** The body types: `fixed` does not move, `kinematic` follows the document and the sequence, `dynamic` falls. */
export const BODY_TYPES = ["dynamic", "fixed", "kinematic"] as const;
export type BodyType = (typeof BODY_TYPES)[number];

export const rigidBodySchema = z.strictObject({
  type: z.enum(BODY_TYPES).optional(),
  /** The mass in kg. With no mass, the density of the collider gives the mass. */
  mass: z.number().positive().max(1000000).optional(),
  linearDamping: z.number().min(0).max(100).optional(),
  angularDamping: z.number().min(0).max(100).optional(),
  /** The linear velocity at t = 0, in metres per second. */
  velocity: vec3Schema.optional(),
  /** The angular velocity at t = 0, in degrees per second about each axis. */
  angularVelocity: vec3Schema.optional(),
  gravityScale: z.number().min(-10).max(10).optional(),
  /** Continuous collision detection: a fast body does not go through a thin collider. */
  ccd: z.boolean().optional(),
});
export type RigidBodyValue = z.infer<typeof rigidBodySchema>;

export const RIGID_BODY_DEFAULTS = {
  type: "dynamic",
  linearDamping: 0,
  angularDamping: 0.05,
  velocity: [0, 0, 0],
  angularVelocity: [0, 0, 0],
  gravityScale: 1,
  ccd: false,
} as const satisfies Omit<Required<RigidBodyValue>, "mass">;

export const rigidBodyComponent = defineComponent({
  id: "physics.rigidBody",
  schema: rigidBodySchema,
  defaults: RIGID_BODY_DEFAULTS,
  editor: {
    label: "Rigid body",
    group: "Physics",
    fields: {
      type: { widget: { kind: "enum", options: BODY_TYPES }, label: "Type" },
      mass: { widget: { kind: "number", unit: "kg", min: 0, step: 0.1 }, label: "Mass" },
      linearDamping: { widget: { kind: "number", min: 0, max: 100, step: 0.05 }, label: "Linear damping" },
      angularDamping: { widget: { kind: "number", min: 0, max: 100, step: 0.05 }, label: "Angular damping" },
      velocity: { widget: { kind: "vector3", unit: "m/s", step: 0.1 }, label: "Initial velocity" },
      angularVelocity: { widget: { kind: "vector3", unit: "deg/s", step: 5 }, label: "Initial spin" },
      gravityScale: { widget: { kind: "number", min: -10, max: 10, step: 0.1 }, label: "Gravity scale" },
      ccd: { widget: { kind: "boolean" }, label: "Continuous collisions" },
    },
  },
});

/** The moves of a character that the input actions of the play mode give. */
export const CHARACTER_MOVES = ["forward", "back", "left", "right", "jump"] as const;
export type CharacterMove = (typeof CHARACTER_MOVES)[number];

/** The input action of each move by default: the actions of the input map of the plugin (input.ts). */
export const DEFAULT_ACTIONS = {
  forward: "physics.forward",
  back: "physics.back",
  left: "physics.left",
  right: "physics.right",
  jump: "physics.jump",
} as const satisfies Record<CharacterMove, string>;

export const characterSchema = z.strictObject({
  /** The radius of the capsule in metres. */
  radius: z.number().positive().max(10).optional(),
  /** The full height of the capsule in metres. The entity position is the base of the capsule. */
  height: z.number().positive().max(20).optional(),
  /** The walk speed in metres per second. */
  speed: z.number().min(0).max(50).optional(),
  /** The upward speed of a jump in metres per second. */
  jumpSpeed: z.number().min(0).max(50).optional(),
  /** The steepest slope that the character can climb, in degrees. */
  maxSlope: z.number().min(0).max(90).optional(),
  /** The highest step that the character can climb, in metres. 0 gives no autostep. */
  stepHeight: z.number().min(0).max(5).optional(),
  /** True: the input actions of the play mode move the character. */
  keyboard: z.boolean().optional(),
  /**
   * The input action of each move (`<plugin>.<name>`). The default actions are those of the input map of the physics
   * plugin. Another action can come from the input map of another plugin, so two characters can have their own keys.
   */
  actions: z.partialRecord(z.enum(CHARACTER_MOVES), z.string().regex(ACTION_PATTERN)).optional(),
});
export type CharacterValue = z.infer<typeof characterSchema>;

export const CHARACTER_DEFAULTS = {
  radius: 0.3,
  height: 1.6,
  speed: 1.5,
  jumpSpeed: 4,
  maxSlope: 45,
  stepHeight: 0.2,
  keyboard: true,
  actions: DEFAULT_ACTIONS,
} as const satisfies Required<CharacterValue>;

export const characterComponent = defineComponent({
  id: "physics.character",
  schema: characterSchema,
  defaults: CHARACTER_DEFAULTS,
  editor: {
    label: "Character controller",
    group: "Physics",
    fields: {
      radius: { widget: { kind: "number", unit: "m", min: 0, step: 0.01 }, label: "Radius" },
      height: { widget: { kind: "number", unit: "m", min: 0, step: 0.01 }, label: "Height" },
      speed: { widget: { kind: "number", unit: "m/s", min: 0, max: 50, step: 0.1 }, label: "Walk speed" },
      jumpSpeed: { widget: { kind: "number", unit: "m/s", min: 0, max: 50, step: 0.1 }, label: "Jump speed" },
      maxSlope: { widget: { kind: "number", unit: "deg", min: 0, max: 90, step: 1 }, label: "Max slope" },
      stepHeight: { widget: { kind: "number", unit: "m", min: 0, max: 5, step: 0.01 }, label: "Step height" },
      keyboard: { widget: { kind: "boolean" }, label: "Play mode input" },
      actions: { widget: { kind: "map", item: { kind: "string" } }, label: "Input actions" },
    },
  },
});

/** The components of the plugin. */
export const physicsComponents = [colliderComponent, rigidBodyComponent, characterComponent] as const;
