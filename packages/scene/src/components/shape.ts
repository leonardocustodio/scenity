// SPDX-License-Identifier: Apache-2.0
/**
 * The built-in `shape` component: a simple mesh that the engine makes, with no model asset. A floor, a wall or a
 * placeholder box of a scene uses it.
 */
import { z } from "zod";
import { assetRefSchema, colourSchema, vec3Schema } from "../schema/common";
import { defineComponent } from "./define";

export const SHAPE_KINDS = ["box", "plane", "cylinder", "sphere"] as const;
export const shapeSchema = z.strictObject({
  kind: z.enum(SHAPE_KINDS),
  /**
   * The size in metres: the width (X), height (Y) and depth (Z) of a box; a plane uses X and Z and lies in the XZ
   * plane with its face up; a cylinder and a sphere use X as the diameter and Y as the height.
   */
  size: vec3Schema.optional(),
  colour: colourSchema.optional(),
  roughness: z.number().min(0).max(1).optional(),
  metalness: z.number().min(0).max(1).optional(),
  /** A material asset in place of the colour, roughness and metalness. */
  material: assetRefSchema.optional(),
  castShadow: z.boolean().optional(),
  receiveShadow: z.boolean().optional(),
});
export type ShapeValue = z.infer<typeof shapeSchema>;

export const shapeComponent = defineComponent({
  id: "shape",
  schema: shapeSchema,
  defaults: {
    size: [1, 1, 1],
    colour: "#cccccc",
    roughness: 0.8,
    metalness: 0,
    castShadow: true,
    receiveShadow: true,
  },
  editor: {
    label: "Shape",
    group: "Render",
    fields: {
      kind: { widget: { kind: "enum", options: SHAPE_KINDS }, label: "Kind" },
      size: { widget: { kind: "vector3", unit: "m", step: 0.01 }, label: "Size" },
      colour: { widget: { kind: "colour" }, label: "Colour" },
      roughness: { widget: { kind: "number", min: 0, max: 1, step: 0.01 }, label: "Roughness" },
      metalness: { widget: { kind: "number", min: 0, max: 1, step: 0.01 }, label: "Metalness" },
      material: { widget: { kind: "assetRef", assetKind: "material" }, label: "Material" },
      castShadow: { widget: { kind: "boolean" }, label: "Cast shadow", group: "Shadow" },
      receiveShadow: { widget: { kind: "boolean" }, label: "Receive shadow", group: "Shadow" },
    },
  },
});
