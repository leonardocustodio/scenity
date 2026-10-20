// SPDX-License-Identifier: Apache-2.0
/**
 * The checks of an entity document (a scene or a prefab) after the zod shell check: the component
 * versions and upcasts, the component values against the registry, the tree and the prefab root.
 */
import type { ComponentRegistry } from "./components/registry";
import type { DocError } from "./errors";
import { checkTree } from "./hierarchy";
import { isObject } from "./json";
import { formatPointer } from "./pointer";
import type { EntityDocument } from "./schema/documents";

export interface CheckResult {
  readonly errors: DocError[];
  readonly warnings: DocError[];
}

/** The component IDs that a raw document uses, with the site fields `environment` and `tags`. */
function usedComponents(raw: Record<string, unknown>): Set<string> {
  const used = new Set<string>();
  if (raw.environment !== undefined) used.add("environment");
  for (const entity of Object.values(isObject(raw.entities) ? raw.entities : {})) {
    if (!isObject(entity)) continue;
    if (entity.tags !== undefined) used.add("tags");
    for (const id of Object.keys(isObject(entity.components) ? entity.components : {})) used.add(id);
  }
  return used;
}

/**
 * Upcast each component value of a raw document to the version of the registry, and write the new `versions` map:
 * an entry for each known component with a version above 1, and each entry of an unknown component as it was.
 */
export function upcastComponents(
  raw: Record<string, unknown>,
  registry: ComponentRegistry,
): { doc: Record<string, unknown>; errors: DocError[] } {
  const errors: DocError[] = [];
  const old = isObject(raw.versions) ? raw.versions : {};
  const versionOf = (id: string) => (typeof old[id] === "number" ? old[id] : 1);
  const step = (id: string, value: unknown, path: string) => {
    const result = registry.upcast(id, value, versionOf(id));
    if (result.ok) return result.value;
    errors.push({ path, message: result.message });
    return value;
  };
  const doc: Record<string, unknown> = { ...raw };
  if (raw.environment !== undefined) doc.environment = step("environment", raw.environment, "/environment");
  if (isObject(raw.entities)) {
    const entities: Record<string, unknown> = {};
    for (const [id, entity] of Object.entries(raw.entities)) {
      entities[id] = isObject(entity) ? upcastEntity(id, entity, step) : entity;
    }
    doc.entities = entities;
  }
  const versions: Record<string, unknown> = {};
  for (const id of usedComponents(doc)) {
    const definition = registry.get(id);
    if (definition !== undefined && definition.version > 1) versions[id] = definition.version;
  }
  for (const [id, version] of Object.entries(old)) if (!registry.has(id)) versions[id] = version;
  if (Object.keys(versions).length > 0) doc.versions = versions;
  else delete doc.versions;
  return { doc, errors };
}

function upcastEntity(
  id: string,
  entity: Record<string, unknown>,
  step: (component: string, value: unknown, path: string) => unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...entity };
  if (entity.tags !== undefined) out.tags = step("tags", entity.tags, formatPointer(["entities", id, "tags"]));
  if (isObject(entity.components)) {
    const components: Record<string, unknown> = {};
    for (const [component, value] of Object.entries(entity.components)) {
      components[component] = step(component, value, formatPointer(["entities", id, "components", component]));
    }
    out.components = components;
  }
  return out;
}

/** Check the component values of each entity against the registry, and check the tree. */
export function checkEntityDocument(doc: EntityDocument, registry: ComponentRegistry): CheckResult {
  const errors: DocError[] = [];
  const warnings: DocError[] = [];
  for (const [id, entity] of Object.entries(doc.entities)) {
    for (const [component, value] of Object.entries(entity.components)) {
      const path = formatPointer(["entities", id, "components", component]);
      const definition = registry.get(component);
      if (definition !== undefined && definition.site !== "component") {
        const where =
          definition.site === "entity" ? `the entity field "${component}"` : `the scene field "${component}"`;
        errors.push({ path, message: `"${component}" is not in the components map: it goes in ${where}` });
        continue;
      }
      const result = registry.check(component, value, path);
      if (result.ok) warnings.push(...result.warnings);
      else errors.push(...result.errors);
    }
  }
  errors.push(...checkTree(doc.entities), ...checkPrefabRoot(doc));
  return { errors, warnings };
}

/** A prefab has one root: the entity `root`, with the parent `null`. */
function checkPrefabRoot(doc: EntityDocument): DocError[] {
  if (doc.format !== "scenity.prefab/1") return [];
  const root = doc.entities[doc.root];
  if (root === undefined) return [{ path: "/root", message: `the root "${doc.root}" is not an entity of the prefab` }];
  const errors: DocError[] = [];
  if (root.parent !== null)
    errors.push({ path: formatPointer(["entities", doc.root, "parent"]), message: "the root has no parent" });
  for (const [id, entity] of Object.entries(doc.entities)) {
    if (id !== doc.root && entity.parent === null) {
      errors.push({
        path: formatPointer(["entities", id, "parent"]),
        message: `a prefab has one root ("${doc.root}")`,
      });
    }
  }
  return errors;
}
