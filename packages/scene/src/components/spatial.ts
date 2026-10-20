// SPDX-License-Identifier: Apache-2.0
/**
 * The built-in components of place and space: `transform`, `socket`, `obstacle`, `standPoint`, `path` and
 * `locomotion`. Lengths are metres and angles are radians.
 */
import { z } from "zod";
import { entityRefSchema, quatSchema, SUB_PATTERN, tagSchema, vec2Schema, vec3Schema } from "../schema/common";
import { defineComponent } from "./define";

const position = { kind: "vector3", unit: "m", step: 0.01 } as const;

export const transformSchema = z.strictObject({
  position: vec3Schema.optional(),
  rotation: quatSchema.optional(),
  scale: vec3Schema.optional(),
});
export type TransformValue = z.infer<typeof transformSchema>;
/** The transform with all its values. */
export interface Transform {
  position: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
}
export const TRANSFORM_DEFAULTS: Transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };

/** The place of an entity relative to its parent: position, rotation (a quaternion [x, y, z, w]) and scale. */
export const transformComponent = defineComponent({
  id: "transform",
  schema: transformSchema,
  defaults: TRANSFORM_DEFAULTS,
  editor: {
    label: "Transform",
    group: "Place",
    fields: {
      position: { widget: position, label: "Position" },
      rotation: { widget: { kind: "quaternion" }, label: "Rotation" },
      scale: { widget: { kind: "vector3", step: 0.01 }, label: "Scale" },
    },
  },
});

/** One socket point: a position, or a position with a rotation. */
export const socketPointSchema = z.union([
  vec3Schema,
  z.strictObject({ position: vec3Schema, rotation: quatSchema.optional() }),
]);
export const socketSchema = z.strictObject({
  points: z.record(z.string().regex(SUB_PATTERN, "not a socket name"), socketPointSchema).optional(),
});
export type SocketValue = z.infer<typeof socketSchema>;
export type SocketPoint = z.infer<typeof socketPointSchema>;

/** Named points in the frame of the entity (`entity:<id>#<name>`), for a snap or an attach. */
export const socketComponent = defineComponent({
  id: "socket",
  schema: socketSchema,
  defaults: { points: {} },
  editor: {
    label: "Sockets",
    group: "Place",
    fields: { points: { widget: { kind: "map", item: position }, label: "Points" } },
  },
});

/** The footprint of an obstacle on the floor (x, z): the bounds of the model, a rectangle or a polygon. */
export const footprintSchema = z.union([
  z.literal("bounds"),
  z.strictObject({ kind: z.literal("rect"), centre: vec2Schema.optional(), size: vec2Schema }),
  z.strictObject({ kind: z.literal("polygon"), points: z.array(vec2Schema).min(3) }),
]);
export const obstacleSchema = z.strictObject({
  footprint: footprintSchema.optional(),
  /** The height in metres. When there is no height, the bounds of the model give it. */
  height: z.number().min(0).optional(),
});
export type ObstacleValue = z.infer<typeof obstacleSchema>;

/** A part of the floor that an actor cannot walk through. */
export const obstacleComponent = defineComponent({
  id: "obstacle",
  schema: obstacleSchema,
  defaults: { footprint: "bounds" },
  editor: {
    label: "Obstacle",
    group: "Navigation",
    fields: {
      footprint: { widget: { kind: "custom", name: "footprint" }, label: "Footprint" },
      height: { widget: { kind: "number", unit: "m", min: 0, step: 0.01 }, label: "Height" },
    },
  },
});

export const standPointSchema = z.strictObject({
  /** The yaw about Y in radians: 0 faces -Z, as a camera of three.js. */
  facing: z.number().optional(),
  role: tagSchema.optional(),
});
export type StandPointValue = z.infer<typeof standPointSchema>;

/** A place where an actor stands, with the direction that it faces and an optional role tag. */
export const standPointComponent = defineComponent({
  id: "standPoint",
  schema: standPointSchema,
  defaults: { facing: 0 },
  editor: {
    label: "Stand point",
    group: "Navigation",
    fields: {
      facing: { widget: { kind: "number", unit: "rad", step: 0.01 }, label: "Facing" },
      role: { widget: { kind: "string" }, label: "Role" },
    },
  },
});

export const pathSchema = z.strictObject({
  points: z.array(vec3Schema).min(2),
  closed: z.boolean().optional(),
  width: z.number().min(0).optional(),
});
export type PathValue = z.infer<typeof pathSchema>;

/** A line of points in the frame of the entity: a walk route, a cable route or a camera route. */
export const pathComponent = defineComponent({
  id: "path",
  schema: pathSchema,
  defaults: { closed: false, width: 0.6 },
  editor: {
    label: "Path",
    group: "Navigation",
    fields: {
      points: { widget: { kind: "curve" }, label: "Points" },
      closed: { widget: { kind: "boolean" }, label: "Closed" },
      width: { widget: { kind: "number", unit: "m", min: 0, step: 0.01 }, label: "Width" },
    },
  },
});

/** One walk of a `locomotion` component: at the time `t` (ms), the actor walks to a stand point. */
export const walkSchema = z.strictObject({
  t: z.number().int().min(0),
  /** The stand point: `entity:<id>` of an entity with a `standPoint` component. */
  to: entityRefSchema,
});
export type WalkValue = z.infer<typeof walkSchema>;

export const locomotionSchema = z.strictObject({
  /** The walk speed in metres per second. */
  speed: z.number().positive().optional(),
  /** The turn speed in radians per second: at the corners of a path and at the stand point. */
  turnSpeed: z.number().positive().optional(),
  /** The animator parameter that gets the walk speed (0 when the actor stands). */
  parameter: z.string().min(1).optional(),
  /** The walks in time order. */
  walks: z
    .array(walkSchema)
    .refine((walks) => walks.every((walk, index) => index === 0 || walk.t >= (walks[index - 1]?.t ?? 0)), {
      message: "the walks are not in time order",
    })
    .optional(),
});
export type LocomotionValue = z.infer<typeof locomotionSchema>;
/** The locomotion with all its values. */
export interface Locomotion {
  speed: number;
  turnSpeed: number;
  parameter: string;
  walks: WalkValue[];
}
export const LOCOMOTION_DEFAULTS: Locomotion = { speed: 1, turnSpeed: 4, parameter: "speed", walks: [] };

/**
 * The walks of an actor to stand points around the obstacles. Each walk has a fixed start time, so the place
 * at a time is a function of the documents and the time.
 */
export const locomotionComponent = defineComponent({
  id: "locomotion",
  schema: locomotionSchema,
  defaults: LOCOMOTION_DEFAULTS,
  editor: {
    label: "Locomotion",
    group: "Navigation",
    fields: {
      speed: { widget: { kind: "number", unit: "m/s", min: 0, step: 0.05 }, label: "Walk speed" },
      turnSpeed: { widget: { kind: "number", unit: "rad/s", min: 0, step: 0.1 }, label: "Turn speed" },
      parameter: { widget: { kind: "string" }, label: "Speed parameter" },
      walks: { widget: { kind: "custom", name: "walks" }, label: "Walks" },
    },
  },
});
