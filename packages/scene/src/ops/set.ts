// SPDX-License-Identifier: Apache-2.0
/**
 * The value ops: `set` (a value at a JSON Pointer; no value removes the key), `addComponent` and
 * `removeComponent`. The ops check the new value against the schemas, and refuse a bad value with a reason.
 */
import type { ComponentRegistry } from "../components/registry";
import { formatErrors, zodErrors } from "../errors";
import { omitKeys } from "../json";
import { formatPointer, getAt, parsePointer, PointerError, setAt } from "../pointer";
import { prefabSchema, sceneSchema, type EntityDocument } from "../schema/documents";
import { entitySchema, type AddComponentOp, type RemoveComponentOp, type SceneOp, type SetOp } from "../schema/entity";
import { done, isPrefab, refuse, withEntities, type StepResult } from "./shared";

/** The top fields that only the reader or other ops change. */
const FIXED_FIELDS = new Set(["format", "id", "versions", "root"]);

/** The reason why a `set` cannot use the path, or undefined when the path is open for a `set`. */
function closedPath(doc: EntityDocument, tokens: readonly string[]): string | undefined {
  const [head, id, field, component] = tokens;
  if (head === undefined) return "a set needs a path below the document";
  if (FIXED_FIELDS.has(head)) return `"/${head}" does not change by an op`;
  if (head !== "entities") return undefined;
  if (id === undefined) return "use add and remove for entities";
  if (!Object.hasOwn(doc.entities, id)) return `the entity "${id}" does not exist`;
  if (field === undefined) return "use add and remove for an entity";
  if (field === "parent" || field === "index") return "use move to change the parent or the index";
  if (field !== "components") return undefined;
  if (component === undefined) return "use addComponent and removeComponent";
  const entity = doc.entities[id];
  if (entity !== undefined && !Object.hasOwn(entity.components, component)) {
    return `the entity "${id}" has no component "${component}": use addComponent`;
  }
  return undefined;
}

/** Check the part of the document that a `set` changed. The result is a reason, or the warnings. */
function checkAfterSet(
  doc: EntityDocument,
  tokens: readonly string[],
  registry: ComponentRegistry,
): { ok: true; warnings: string[] } | { ok: false; reason: string } {
  const [head, id, field, component] = tokens;
  if (head === "entities" && id !== undefined) {
    const entity = doc.entities[id];
    const base = formatPointer(["entities", id]);
    const parsed = entitySchema.safeParse(entity);
    if (!parsed.success) return { ok: false, reason: formatErrors(zodErrors(parsed.error, base)) };
    if (field !== "components" || component === undefined || entity === undefined) return { ok: true, warnings: [] };
    const check = registry.check(component, entity.components[component], `${base}/components/${component}`);
    if (!check.ok) return { ok: false, reason: formatErrors(check.errors) };
    return { ok: true, warnings: check.warnings.map((item) => item.message) };
  }
  const shell = { ...doc, entities: {} };
  const parsed = isPrefab(doc) ? prefabSchema.safeParse(shell) : sceneSchema.safeParse(shell);
  if (!parsed.success) return { ok: false, reason: formatErrors(zodErrors(parsed.error)) };
  return { ok: true, warnings: [] };
}

export function applySet(doc: EntityDocument, op: SetOp, registry: ComponentRegistry): StepResult {
  const tokens = parsePointer(op.path);
  if (tokens === undefined) return refuse(`"${op.path}" is not a JSON Pointer`);
  const closed = closedPath(doc, tokens);
  if (closed !== undefined) return refuse(closed);
  if (tokens.length === 4 && op.value === undefined) return refuse("use removeComponent to remove a component");
  const old = getAt(doc, tokens);
  const next = setAt(doc, tokens, op.value);
  if (next instanceof PointerError) return refuse(`${op.path}: ${next.reason}`);
  const changed = next as EntityDocument;
  const check = checkAfterSet(changed, tokens, registry);
  if (!check.ok) return refuse(check.reason);
  const inverse: SetOp =
    old === undefined ? { op: "set", path: op.path } : { op: "set", path: op.path, value: old as SetOp["value"] };
  return done(changed, [inverse], check.warnings);
}

export function applyAddComponent(doc: EntityDocument, op: AddComponentOp, registry: ComponentRegistry): StepResult {
  const entity = doc.entities[op.id];
  if (entity === undefined) return refuse(`the entity "${op.id}" does not exist`);
  if (Object.hasOwn(entity.components, op.component)) {
    return refuse(`the entity "${op.id}" has a component "${op.component}" already`);
  }
  const definition = registry.get(op.component);
  if (definition !== undefined && definition.site !== "component") {
    return refuse(`"${op.component}" is not in the components map: it is a ${definition.site} field`);
  }
  const path = formatPointer(["entities", op.id, "components", op.component]);
  const check = registry.check(op.component, op.value, path);
  if (!check.ok) return refuse(formatErrors(check.errors));
  const components = { ...entity.components, [op.component]: op.value };
  const entities = { ...doc.entities, [op.id]: { ...entity, components } };
  const inverse: SceneOp = { op: "removeComponent", id: op.id, component: op.component };
  return done(
    withEntities(doc, entities),
    [inverse],
    check.warnings.map((item) => item.message),
  );
}

export function applyRemoveComponent(doc: EntityDocument, op: RemoveComponentOp): StepResult {
  const entity = doc.entities[op.id];
  if (entity === undefined) return refuse(`the entity "${op.id}" does not exist`);
  if (!Object.hasOwn(entity.components, op.component)) {
    return refuse(`the entity "${op.id}" has no component "${op.component}"`);
  }
  const value = entity.components[op.component] as SetOp["value"];
  const components = omitKeys(entity.components, [op.component]);
  const entities = { ...doc.entities, [op.id]: { ...entity, components } };
  const inverse: SceneOp = { op: "addComponent", id: op.id, component: op.component, value: value ?? null };
  return done(withEntities(doc, entities), [inverse]);
}
