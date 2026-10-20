// SPDX-License-Identifier: Apache-2.0
/**
 * The assignment of a material asset to a part of an entity, over the material overrides of a model. A `model` entity
 * takes a material asset for a part: a key `mesh:<node>` (a mesh or a node of the model) or a material name of the
 * model. A `shape` entity takes it in place of its colour. The assignment is one scene op, and thus one step of the
 * history. It replaces the override of the part. The reason is that the values of the old override (a colour, a
 * roughness) are tweaks of the old material, and they would hide the new material. No Vue import.
 */
import { MESH_PART_PREFIX, type ModelValue } from "@scenity/scene/components";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import { SUB_PATTERN } from "@scenity/scene/schema/common";
import { formatPointer } from "@scenity/scene";
import { EditError } from "../ops";

/** The part names of a model, as the inspect report of the dev core gives them (`parts`). */
export interface PartNames {
  readonly meshes: readonly string[];
  readonly materials: readonly string[];
}

/** One part of an entity that can take a material asset. */
export interface MaterialTarget {
  /** The override key (`mesh:<node>` or a material name), or null for the material of a shape. */
  readonly key: string | null;
  readonly label: string;
  /** The current material asset of the part, or null. */
  readonly material: string | null;
}

/** The override key of a mesh or a node of a model. */
export function meshPartKey(name: string): string {
  return `${MESH_PART_PREFIX}${name}`;
}

/**
 * The parts of an entity that can take a material asset: the shape, or each part of the model (the override keys
 * of the document first, then the meshes and the materials of `parts`). Empty for an entity with no model or shape.
 */
export function materialTargets(doc: EntityDocument, id: string, parts?: PartNames): MaterialTarget[] {
  const components = doc.entities[id]?.components;
  if (components === undefined) return [];
  const shape = components.shape as { material?: string } | undefined;
  if (shape !== undefined) return [{ key: null, label: "Shape", material: shape.material ?? null }];
  const model = components.model as ModelValue | undefined;
  if (model === undefined) return [];
  const overrides = model.materials ?? {};
  const keys = [
    ...Object.keys(overrides).sort(),
    ...(parts?.meshes ?? []).map(meshPartKey),
    ...(parts?.materials ?? []),
  ].filter((key) => SUB_PATTERN.test(key));
  return [...new Set(keys)].map((key) => ({
    key,
    label: key.startsWith(MESH_PART_PREFIX) ? `Mesh ${key.slice(MESH_PART_PREFIX.length)}` : `Material ${key}`,
    material: overrides[key]?.material ?? null,
  }));
}

/**
 * The scene ops that assign the material asset `ref` to a part of the entity `id`: the material of a shape (`key`
 * null), or the override of the part `key` of a model. `ref` null removes the material asset from the part.
 */
export function assignMaterialOps(doc: EntityDocument, id: string, key: string | null, ref: string | null): SceneOp[] {
  const components = doc.entities[id]?.components;
  if (components === undefined) throw new EditError(`No entity "${id}".`);
  if (key === null) {
    if (components.shape === undefined) throw new EditError(`The entity "${id}" has no shape.`);
    const path = formatPointer(["entities", id, "components", "shape", "material"]);
    return [ref === null ? { op: "set", path } : { op: "set", path, value: ref }];
  }
  const model = components.model as ModelValue | undefined;
  if (model === undefined) throw new EditError(`The entity "${id}" has no model.`);
  if (!SUB_PATTERN.test(key)) throw new EditError(`"${key}" is not a part name.`);
  const others = Object.entries(model.materials ?? {}).filter(([name]) => name !== key);
  const overrides = Object.fromEntries(ref === null ? others : [...others, [key, { material: ref }]]);
  const path = formatPointer(["entities", id, "components", "model", "materials"]);
  // A set with no value removes the key.
  if (Object.keys(overrides).length === 0) return model.materials === undefined ? [] : [{ op: "set", path }];
  return [{ op: "set", path, value: overrides as Extract<SceneOp, { op: "set" }>["value"] }];
}

/** The entities of a document that use the material asset `ref`: a shape, or a part override of a model. */
export function materialUsers(doc: EntityDocument, ref: string): string[] {
  return Object.keys(doc.entities)
    .filter((id) => {
      const components = doc.entities[id]?.components;
      if ((components?.shape as { material?: string } | undefined)?.material === ref) return true;
      const overrides = (components?.model as ModelValue | undefined)?.materials ?? {};
      return Object.values(overrides).some((override) => override.material === ref);
    })
    .sort();
}
