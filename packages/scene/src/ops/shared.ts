// SPDX-License-Identifier: Apache-2.0
/**
 * The shared parts of the op functions: the result of one op and the helpers that change the entity map.
 * Each helper makes new objects only for the entities that change.
 */
import type { Entity, SceneOp } from "../schema/entity";
import type { EntityDocument } from "../schema/documents";

/** The result of one op: the new document and the ops that undo it, or the reason of a refusal. */
export type StepResult =
  | { readonly ok: true; readonly doc: EntityDocument; readonly inverse: SceneOp[]; readonly warnings: string[] }
  | { readonly ok: false; readonly reason: string };

export function refuse(reason: string): StepResult {
  return { ok: false, reason };
}

export function done(doc: EntityDocument, inverse: SceneOp[], warnings: string[] = []): StepResult {
  return { ok: true, doc, inverse, warnings };
}

export function withEntities(doc: EntityDocument, entities: Record<string, Entity>): EntityDocument {
  return { ...doc, entities };
}

export function isPrefab(doc: EntityDocument): doc is Extract<EntityDocument, { format: "scenity.prefab/1" }> {
  return doc.format === "scenity.prefab/1";
}

/**
 * Add `delta` to the index of each child of `parent` with an index at `from` or above. The function changes only the
 * entities that move, and leaves out the entity `skip`.
 */
export function shiftSiblings(
  entities: Record<string, Entity>,
  parent: string | null,
  from: number,
  delta: number,
  skip?: string,
): void {
  for (const [id, entity] of Object.entries(entities)) {
    if (id === skip || entity.parent !== parent || entity.index < from) continue;
    entities[id] = { ...entity, index: entity.index + delta };
  }
}

/** The number of children of a parent, without the entity `skip`. */
export function childCount(entities: Readonly<Record<string, Entity>>, parent: string | null, skip?: string): number {
  let count = 0;
  for (const [id, entity] of Object.entries(entities)) if (id !== skip && entity.parent === parent) count += 1;
  return count;
}
