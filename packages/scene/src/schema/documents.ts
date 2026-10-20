// SPDX-License-Identifier: Apache-2.0
/**
 * The zod schemas of the scene, prefab and override documents. These are the shell schemas: the
 * component values are `unknown`, and the component registry checks them. `sceneSchemaFor` gives a schema with the
 * known components in it, for the JSON Schema export.
 */
import { z } from "zod";
import type { ComponentRegistry } from "../components/registry";
import { environmentSchema } from "../components/visual";
import { componentIdSchema, idSchema, relativePathSchema, tagsSchema } from "./common";
import { entitySchema, opSchema } from "./entity";
import { ruleListSchema } from "./rules";

/** The versions of the components in a document. A component that is not in the map has version 1. */
export const versionsSchema = z.record(componentIdSchema, z.number().int().min(1));
const variantNameSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/, "not a variant name");

function sceneShape<E extends z.ZodType>(entities: E) {
  return {
    format: z.literal("scenity.scene/1"),
    id: idSchema,
    name: z.string().min(1).max(200).optional(),
    environment: environmentSchema.optional(),
    entities: z.record(idSchema, entities),
    /** The variants: a name, and the path of an override file relative to the scene file. */
    variants: z.record(variantNameSchema, relativePathSchema).optional(),
    versions: versionsSchema.optional(),
    /** The rules of the scene (the default scope is `scene`). */
    rules: ruleListSchema.optional(),
    /**
     * The poster image of the scene, a path relative to the scene file (WebP, PNG or JPEG). The player shows it until
     * the first frame, and keeps it when no renderer works. `scenity build` copies the file.
     */
    poster: relativePathSchema.optional(),
  };
}

function prefabShape<E extends z.ZodType>(entities: E) {
  return {
    format: z.literal("scenity.prefab/1"),
    id: idSchema,
    name: z.string().min(1).max(200).optional(),
    /** The root entity: the one entity with the parent `null`. */
    root: idSchema,
    entities: z.record(idSchema, entities),
    versions: versionsSchema.optional(),
  };
}

export const sceneSchema = z.strictObject(sceneShape(entitySchema));
export const prefabSchema = z.strictObject(prefabShape(entitySchema));
export const overridesSchema = z.strictObject({
  format: z.literal("scenity.overrides/1"),
  /** The ID of the scene that the layer is for. */
  scene: idSchema,
  name: z.string().min(1).max(200).optional(),
  ops: z.array(opSchema),
});

export type SceneDocument = z.infer<typeof sceneSchema>;
export type PrefabDocument = z.infer<typeof prefabSchema>;
export type OverridesDocument = z.infer<typeof overridesSchema>;
/** A document with an entity tree: a scene or a prefab. The ops apply to both. */
export type EntityDocument = SceneDocument | PrefabDocument;

/** The entity schema with the known components of the registry in `components` (other components stay open). */
function typedEntitySchema(registry: ComponentRegistry) {
  const known = Object.fromEntries(registry.atSite("component").map((item) => [item.id, item.schema.optional()]));
  return z.strictObject({ ...entitySchema.shape, components: z.looseObject(known), tags: tagsSchema.optional() });
}

/** The scene schema with the known components, for the JSON Schema export. */
export function sceneSchemaFor(registry: ComponentRegistry) {
  return z.strictObject(sceneShape(typedEntitySchema(registry)));
}

/** The prefab schema with the known components, for the JSON Schema export. */
export function prefabSchemaFor(registry: ComponentRegistry) {
  return z.strictObject(prefabShape(typedEntitySchema(registry)));
}
