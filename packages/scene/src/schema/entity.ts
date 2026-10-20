// SPDX-License-Identifier: Apache-2.0
/**
 * The zod schemas of an entity and of the ops. The scene, the prefab and the override documents use them. The
 * component values are `unknown` here: the component registry checks them.
 */
import { z } from "zod";
import { componentIdSchema, idSchema, tagsSchema } from "./common";

/** One entity of a scene or a prefab: its place in the tree, its name, its tags and its components. */
export const entitySchema = z.strictObject({
  name: z.string().min(1).max(200).optional(),
  parent: idSchema.nullable(),
  index: z.number().int().min(0),
  tags: tagsSchema.optional(),
  components: z.record(componentIdSchema, z.unknown()),
});

/** The pointer of a `set` op: `/` and the tokens. */
const opPathSchema = z.string().regex(/^\//, "an op path is a JSON Pointer that starts with '/'");

export const setOpSchema = z.strictObject({
  op: z.literal("set"),
  path: opPathSchema,
  /** The new value. When there is no value, the op removes the key. */
  value: z.json().optional(),
});
export const addOpSchema = z.strictObject({ op: z.literal("add"), id: idSchema, entity: entitySchema });
export const removeOpSchema = z.strictObject({ op: z.literal("remove"), id: idSchema });
export const moveOpSchema = z.strictObject({
  op: z.literal("move"),
  id: idSchema,
  parent: idSchema.nullable(),
  index: z.number().int().min(0),
});
export const addComponentOpSchema = z.strictObject({
  op: z.literal("addComponent"),
  id: idSchema,
  component: componentIdSchema,
  value: z.json(),
});
export const removeComponentOpSchema = z.strictObject({
  op: z.literal("removeComponent"),
  id: idSchema,
  component: componentIdSchema,
});

/** One edit of a scene or a prefab. */
export const opSchema = z.discriminatedUnion("op", [
  setOpSchema,
  addOpSchema,
  removeOpSchema,
  moveOpSchema,
  addComponentOpSchema,
  removeComponentOpSchema,
]);

export type Entity = z.infer<typeof entitySchema>;
export type SceneOp = z.infer<typeof opSchema>;
export type SetOp = z.infer<typeof setOpSchema>;
export type AddOp = z.infer<typeof addOpSchema>;
export type RemoveOp = z.infer<typeof removeOpSchema>;
export type MoveOp = z.infer<typeof moveOpSchema>;
export type AddComponentOp = z.infer<typeof addComponentOpSchema>;
export type RemoveComponentOp = z.infer<typeof removeComponentOpSchema>;
