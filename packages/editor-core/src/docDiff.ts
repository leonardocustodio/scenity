// SPDX-License-Identifier: Apache-2.0
/**
 * The ops between two versions of an entity document. An editor window sends the ops of its change to the document
 * session of the host, and the other windows apply them. The ops are:
 * - `remove` for the entities that go (the children first);
 * - `add` for the new entities (the parents first);
 * - `move` for a new parent or place;
 * - `set` for a new name or another value of an entity;
 * - `addComponent`, `removeComponent` and `set` for the components;
 * - `set` for the values of the document itself.
 *
 * `docOps` checks that the ops give the new document, else it gives null. No Vue import.
 */
import { applyOps, formatPointer, jsonEqual, type ComponentRegistry } from "@scenity/scene";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import type { Entity, SceneOp } from "@scenity/scene/schema/entity";

/** The keys of a document that the ops never change. */
const FIXED = new Set(["format", "id", "entities"]);
/** The keys of an entity that `move` and the component ops change. */
const PLACE = new Set(["parent", "index", "components"]);

type Json = Extract<SceneOp, { op: "set" }>["value"];

/** The depth of an entity in its tree (a root is 0). */
function depth(entities: Readonly<Record<string, Entity>>, id: string): number {
  let count = 0;
  for (let at = entities[id]?.parent ?? null; at !== null && count < 1000; at = entities[at]?.parent ?? null)
    count += 1;
  return count;
}

function set(tokens: readonly string[], value: unknown): SceneOp {
  const path = formatPointer([...tokens]);
  return value === undefined ? { op: "set", path } : { op: "set", path, value: value as Json };
}

/** The ops of the values of the document itself (`environment`, `name`, …). */
function documentOps(prev: EntityDocument, next: EntityDocument): SceneOp[] {
  const before = prev as unknown as Record<string, unknown>;
  const after = next as unknown as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !FIXED.has(key));
  return keys.filter((key) => !jsonEqual(before[key], after[key])).map((key) => set([key], after[key]));
}

/** The ops of an entity in both versions. */
function entityOps(id: string, prev: Entity, next: Entity): SceneOp[] {
  const ops: SceneOp[] = [];
  if (prev.parent !== next.parent || prev.index !== next.index) {
    ops.push({ op: "move", id, parent: next.parent, index: next.index });
  }
  const before = prev as unknown as Record<string, unknown>;
  const after = next as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!PLACE.has(key) && !jsonEqual(before[key], after[key])) ops.push(set(["entities", id, key], after[key]));
  }
  for (const component of Object.keys(prev.components)) {
    if (!Object.hasOwn(next.components, component)) ops.push({ op: "removeComponent", id, component });
  }
  for (const [component, value] of Object.entries(next.components)) {
    if (!Object.hasOwn(prev.components, component)) {
      ops.push({ op: "addComponent", id, component, value: value as NonNullable<Json> });
    } else if (!jsonEqual(prev.components[component], value)) {
      ops.push(set(["entities", id, "components", component], value));
    }
  }
  return ops;
}

/** The ops from one version of a document to another; null when the ops do not give the new version exactly. */
export function docOps(prev: EntityDocument, next: EntityDocument, registry: ComponentRegistry): SceneOp[] | null {
  const before = prev.entities;
  const after = next.entities;
  const gone = Object.keys(before)
    .filter((id) => !Object.hasOwn(after, id))
    .sort((a, b) => depth(before, b) - depth(before, a));
  const added = Object.keys(after)
    .filter((id) => !Object.hasOwn(before, id))
    .sort((a, b) => depth(after, a) - depth(after, b) || (after[a]?.index ?? 0) - (after[b]?.index ?? 0));
  const ops: SceneOp[] = [
    ...gone.map((id): SceneOp => ({ op: "remove", id })),
    ...added.flatMap((id): SceneOp[] => {
      const entity = after[id];
      return entity === undefined ? [] : [{ op: "add", id, entity }];
    }),
    ...Object.keys(after).flatMap((id) => {
      const old = before[id];
      const now = after[id];
      return old === undefined || now === undefined ? [] : entityOps(id, old, now);
    }),
    ...documentOps(prev, next),
  ];
  if (ops.length === 0) return [];
  const result = applyOps(prev, ops, registry);
  return result.ok && jsonEqual(result.doc, next) ? ops : null;
}
