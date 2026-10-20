// SPDX-License-Identifier: Apache-2.0
/**
 * The built-in components of state and notes: `tags` (an entity field), `visibility`, `pickable`,
 * `annotation` and `prefab`.
 */
import { z } from "zod";
import { colourSchema, relativePathSchema, tagSchema, tagsSchema } from "../schema/common";
import { opSchema } from "../schema/entity";
import { defineComponent } from "./define";

/** The tags of an entity. The entity keeps them in its field `tags`, not in `components`. */
export const tagsComponent = defineComponent({
  id: "tags",
  site: "entity",
  schema: tagsSchema,
  defaults: [],
  editor: {
    label: "Tags",
    group: "General",
    fields: { tags: { widget: { kind: "list", item: { kind: "string" } }, label: "Tags" } },
  },
});

export const visibilitySchema = z.strictObject({ visible: z.boolean().optional() });
export type VisibilityValue = z.infer<typeof visibilitySchema>;

/** The visibility of an entity and its subtree. */
export const visibilityComponent = defineComponent({
  id: "visibility",
  schema: visibilitySchema,
  defaults: { visible: true },
  editor: {
    label: "Visibility",
    group: "General",
    fields: { visible: { widget: { kind: "boolean" }, label: "Visible" } },
  },
});

/** The hit test of a pick: the box of the entity objects, or the triangles of their meshes. */
export const PICK_MODES = ["bounds", "mesh"] as const;
export type PickMode = (typeof PICK_MODES)[number];

export const pickableSchema = z.strictObject({
  enabled: z.boolean().optional(),
  /** The order when two entities are under the pointer: the higher value wins. */
  priority: z.number().int().optional(),
  /** The hit test. An entity with no `pickable` component uses "mesh". */
  mode: z.enum(PICK_MODES).optional(),
  /** The pick layers of the entity. A pick with a layer list hits only an entity with one of those layers. */
  layers: z.array(tagSchema).optional(),
});
export type PickableValue = z.infer<typeof pickableSchema>;
/** The pickable value with all its values. */
export interface Pickable {
  enabled: boolean;
  priority: number;
  mode: PickMode;
  layers: string[];
}
/** The pick values of an entity with no `pickable` component: the same as the defaults of the component. */
export const PICKABLE_DEFAULTS: Pickable = { enabled: true, priority: 0, mode: "mesh", layers: ["default"] };

/** The editor and the player can pick the entity with the pointer. */
export const pickableComponent = defineComponent({
  id: "pickable",
  schema: pickableSchema,
  defaults: PICKABLE_DEFAULTS,
  editor: {
    label: "Pickable",
    group: "General",
    fields: {
      enabled: { widget: { kind: "boolean" }, label: "Enabled" },
      priority: { widget: { kind: "number", step: 1 }, label: "Priority" },
      mode: { widget: { kind: "enum", options: PICK_MODES }, label: "Hit test" },
      layers: { widget: { kind: "list", item: { kind: "string" } }, label: "Layers" },
    },
  },
});

/** The states of a note as a task. */
export const NOTE_STATES = ["open", "done"] as const;

export const annotationSchema = z.strictObject({
  text: z.string().min(1),
  colour: colourSchema.optional(),
  /** A note as a task: open, or done (an agent did it). */
  status: z.enum(NOTE_STATES).optional(),
  /** The turn of the agent session that did the task (`<session>#<turn>`, its change set). */
  task: z.string().min(1).max(160).optional(),
});
export type AnnotationValue = z.infer<typeof annotationSchema>;

/** A note at the place of the entity. The editor shows it, but the player does not. */
export const annotationComponent = defineComponent({
  id: "annotation",
  schema: annotationSchema,
  defaults: { colour: "#ffd166" },
  editor: {
    label: "Annotation",
    group: "General",
    fields: {
      text: { widget: { kind: "string", multiline: true }, label: "Text" },
      colour: { widget: { kind: "colour" }, label: "Colour" },
      status: { widget: { kind: "enum", options: NOTE_STATES }, label: "Status" },
      task: { widget: { kind: "string" }, label: "Task of the agent" },
    },
  },
});

/** The source of a prefab: `asset:<id>`, or a path relative to the document that ends in `.prefab.json`. */
export const prefabSourceSchema = z.union([
  z.string().regex(/^asset:[A-Za-z0-9_.-]{1,128}$/, "a prefab source is asset:<id> or a .prefab.json path"),
  relativePathSchema.regex(/\.prefab\.json$/, "a prefab source is asset:<id> or a .prefab.json path"),
]);
export const prefabInstanceSchema = z.strictObject({
  source: prefabSourceSchema,
  /** The instance overrides: ops on the prefab document, with the entity IDs of the prefab. */
  overrides: z.array(opSchema).optional(),
});
export type PrefabValue = z.infer<typeof prefabInstanceSchema>;

/** An instance of a prefab: the prefab entities go under this entity when the scene expands. */
export const prefabComponent = defineComponent({
  id: "prefab",
  schema: prefabInstanceSchema,
  defaults: { overrides: [] },
  editor: {
    label: "Prefab",
    group: "General",
    fields: {
      source: { widget: { kind: "assetRef", assetKind: "prefab" }, label: "Prefab" },
      overrides: { widget: { kind: "custom", name: "prefabOverrides" }, label: "Overrides" },
    },
  },
});
