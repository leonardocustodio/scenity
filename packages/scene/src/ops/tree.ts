// SPDX-License-Identifier: Apache-2.0
/**
 * The tree ops: `add` (one entity with its ID), `remove` (an entity and its subtree) and `move` (a new
 * parent and index). Each op keeps the indexes of the children of each parent at 0..n-1.
 */
import type { ComponentRegistry } from "../components/registry";
import { formatErrors } from "../errors";
import { isInSubtree, subtreeOf } from "../hierarchy";
import { omitKeys } from "../json";
import { formatPointer } from "../pointer";
import type { EntityDocument } from "../schema/documents";
import type { AddOp, Entity, MoveOp, RemoveOp, SceneOp } from "../schema/entity";
import { childCount, done, isPrefab, refuse, shiftSiblings, withEntities, type StepResult } from "./shared";

/** Check the components of an entity against the registry. The result is a reason, or the warnings. */
export function checkComponents(
  id: string,
  entity: Entity,
  registry: ComponentRegistry,
): { ok: true; warnings: string[] } | { ok: false; reason: string } {
  const warnings: string[] = [];
  for (const [component, value] of Object.entries(entity.components)) {
    const definition = registry.get(component);
    if (definition !== undefined && definition.site !== "component") {
      return { ok: false, reason: `"${component}" is not in the components map: it is a ${definition.site} field` };
    }
    const check = registry.check(component, value, formatPointer(["entities", id, "components", component]));
    if (!check.ok) return { ok: false, reason: formatErrors(check.errors) };
    warnings.push(...check.warnings.map((item) => item.message));
  }
  return { ok: true, warnings };
}

export function applyAdd(doc: EntityDocument, op: AddOp, registry: ComponentRegistry): StepResult {
  const { id, entity } = op;
  if (Object.hasOwn(doc.entities, id)) return refuse(`the entity "${id}" exists already`);
  const parent = entity.parent;
  if (parent !== null && !Object.hasOwn(doc.entities, parent)) return refuse(`the parent "${parent}" does not exist`);
  if (parent === null && isPrefab(doc)) return refuse(`a prefab has one root ("${doc.root}")`);
  const count = childCount(doc.entities, parent);
  if (entity.index > count) return refuse(`the index ${String(entity.index)} is above ${String(count)}`);
  const check = checkComponents(id, entity, registry);
  if (!check.ok) return refuse(check.reason);
  const entities = { ...doc.entities };
  shiftSiblings(entities, parent, entity.index, 1);
  entities[id] = entity;
  return done(withEntities(doc, entities), [{ op: "remove", id }], check.warnings);
}

export function applyRemove(doc: EntityDocument, op: RemoveOp): StepResult {
  const target = doc.entities[op.id];
  if (target === undefined) return refuse(`the entity "${op.id}" does not exist`);
  if (isPrefab(doc) && op.id === doc.root) return refuse("the root of a prefab cannot be removed");
  const ids = subtreeOf(doc.entities, op.id);
  const entities = omitKeys(doc.entities, ids);
  shiftSiblings(entities, target.parent, target.index + 1, -1);
  // The adds go parents first and children in index order, so each add finds its parent and its index.
  const inverse: SceneOp[] = [];
  for (const id of ids) {
    const entity = doc.entities[id];
    if (entity !== undefined) inverse.push({ op: "add", id, entity });
  }
  return done(withEntities(doc, entities), inverse);
}

export function applyMove(doc: EntityDocument, op: MoveOp): StepResult {
  const { id, parent, index } = op;
  const entity = doc.entities[id];
  if (entity === undefined) return refuse(`the entity "${id}" does not exist`);
  if (parent !== null && !Object.hasOwn(doc.entities, parent)) return refuse(`the parent "${parent}" does not exist`);
  if (parent !== null && isInSubtree(doc.entities, parent, id)) {
    return refuse(`the parent "${parent}" is in the subtree of "${id}": the move makes a cycle`);
  }
  if (isPrefab(doc) && (id === doc.root || parent === null)) {
    return refuse(id === doc.root ? "the root of a prefab cannot move" : `a prefab has one root ("${doc.root}")`);
  }
  const count = childCount(doc.entities, parent, id);
  if (index > count) return refuse(`the index ${String(index)} is above ${String(count)}`);
  const entities = { ...doc.entities };
  shiftSiblings(entities, entity.parent, entity.index + 1, -1, id);
  shiftSiblings(entities, parent, index, 1, id);
  entities[id] = { ...entity, parent, index };
  return done(withEntities(doc, entities), [{ op: "move", id, parent: entity.parent, index: entity.index }]);
}
