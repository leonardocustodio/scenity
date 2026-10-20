// SPDX-License-Identifier: Apache-2.0
/**
 * The diff of two entity documents: a short op list that changes the first document into the second, for
 * "save as variant". The list has `add`, `remove` and `move` for the tree, `addComponent` and `removeComponent` for
 * the component sets, and `set` for each changed value.
 */
import { childrenMap } from "../hierarchy";
import { isObject, jsonEqual, sortedKeys } from "../json";
import { formatPointer } from "../pointer";
import type { EntityDocument } from "../schema/documents";
import type { Entity, SceneOp, SetOp } from "../schema/entity";

type Value = SetOp["value"];

/** True for two arrays of numbers only with more than one changed item. */
function manyNumbers(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (![...a, ...b].every((item) => typeof item === "number")) return false;
  return a.filter((item, index) => item !== b[index]).length > 1;
}

/**
 * The `set` ops that change `a` into `b` at the tokens: per key for objects, per item for arrays of one length. An
 * array of numbers (a vector, a quaternion, a colour) with more than one changed item is one value: one `set` changes
 * all of it, so each op of the list gives a valid document (a quaternion stays a unit quaternion after each op).
 */
export function diffValues(a: unknown, b: unknown, tokens: readonly string[]): SetOp[] {
  if (jsonEqual(a, b)) return [];
  const path = formatPointer(tokens);
  if (isObject(a) && isObject(b)) {
    const keys = [...new Set([...sortedKeys(a), ...sortedKeys(b)])].sort();
    return keys.flatMap((key) => {
      if (!Object.hasOwn(b, key)) return [{ op: "set" as const, path: formatPointer([...tokens, key]) }];
      if (!Object.hasOwn(a, key))
        return [{ op: "set" as const, path: formatPointer([...tokens, key]), value: b[key] as Value }];
      return diffValues(a[key], b[key], [...tokens, key]);
    });
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && !manyNumbers(a, b)) {
    return a.flatMap((item, index) => diffValues(item, b[index], [...tokens, String(index)]));
  }
  return [{ op: "set", path, value: b as Value }];
}

/** The IDs of the entities of a document, parents first, then by index. */
function breadthFirst(entities: Readonly<Record<string, Entity>>): string[] {
  const map = childrenMap(entities);
  const out: string[] = [];
  const queue = [...(map.get("") ?? [])];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) continue;
    out.push(id);
    queue.push(...(map.get(id) ?? []));
  }
  return out;
}

/** A small model of the tree. The diff changes it when it makes the tree ops. */
class TreeModel {
  readonly children = new Map<string, string[]>();
  readonly parentOf = new Map<string, string>();

  constructor(entities: Readonly<Record<string, Entity>>) {
    for (const [key, ids] of childrenMap(entities)) {
      this.children.set(key, [...ids]);
      for (const id of ids) this.parentOf.set(id, key);
    }
  }

  list(parent: string): string[] {
    const list = this.children.get(parent) ?? [];
    this.children.set(parent, list);
    return list;
  }

  remove(id: string): void {
    const list = this.list(this.parentOf.get(id) ?? "");
    list.splice(list.indexOf(id), 1);
    this.parentOf.delete(id);
  }

  insert(id: string, parent: string, index: number): void {
    this.list(parent).splice(index, 0, id);
    this.parentOf.set(id, parent);
  }
}

/** The tree ops: adds and moves to the new parents (at the end), removes, then moves into the new order. */
function treeOps(a: Readonly<Record<string, Entity>>, b: Readonly<Record<string, Entity>>): SceneOp[] {
  const ops: SceneOp[] = [];
  const tree = new TreeModel(a);
  const key = (parent: string | null) => parent ?? "";
  for (const id of breadthFirst(b)) {
    const target = b[id];
    if (target === undefined) continue;
    const before = a[id];
    const index = tree.list(key(target.parent)).filter((item) => item !== id).length;
    if (before === undefined) {
      ops.push({ op: "add", id, entity: { ...target, index } });
      tree.insert(id, key(target.parent), index);
    } else if (before.parent !== target.parent) {
      ops.push({ op: "move", id, parent: target.parent, index });
      tree.remove(id);
      tree.insert(id, key(target.parent), index);
    }
  }
  for (const id of breadthFirst(a)) {
    const parent = tree.parentOf.get(id);
    if (b[id] !== undefined || parent === undefined) continue;
    if (parent !== "" && b[parent] === undefined) continue;
    ops.push({ op: "remove", id });
    tree.remove(id);
  }
  for (const [parent, ids] of childrenMap(b)) {
    const list = tree.list(parent);
    ids.forEach((id, index) => {
      if (list[index] === id) return;
      ops.push({ op: "move", id, parent: parent === "" ? null : parent, index });
      tree.remove(id);
      tree.insert(id, parent, index);
    });
  }
  return ops;
}

/** The component and field ops of an entity that is in both documents. */
function entityOps(id: string, a: Entity, b: Entity): SceneOp[] {
  const ops: SceneOp[] = [];
  for (const field of ["name", "tags"] as const) ops.push(...diffValues(a[field], b[field], ["entities", id, field]));
  const ids = [...new Set([...sortedKeys(a.components), ...sortedKeys(b.components)])].sort();
  for (const component of ids) {
    const before = a.components[component];
    const after = b.components[component];
    if (!Object.hasOwn(b.components, component)) ops.push({ op: "removeComponent", id, component });
    else if (!Object.hasOwn(a.components, component)) {
      ops.push({ op: "addComponent", id, component, value: after as NonNullable<Value> });
    } else ops.push(...diffValues(before, after, ["entities", id, "components", component]));
  }
  return ops;
}

/**
 * The ops that change the document `a` into `b`. `applyOps(a, diffDocuments(a, b))` gives a document equal to `b`.
 * The top fields `format`, `id`, `root` and `versions` must be equal.
 */
export function diffDocuments(a: EntityDocument, b: EntityDocument): SceneOp[] {
  const top = new Set([...Object.keys(a), ...Object.keys(b)]);
  const ops: SceneOp[] = [];
  for (const field of [...top].sort()) {
    if (["format", "id", "root", "versions", "entities"].includes(field)) continue;
    ops.push(...diffValues((a as Record<string, unknown>)[field], (b as Record<string, unknown>)[field], [field]));
  }
  ops.push(...treeOps(a.entities, b.entities));
  for (const id of sortedKeys(b.entities)) {
    const before = a.entities[id];
    const after = b.entities[id];
    if (before !== undefined && after !== undefined) ops.push(...entityOps(id, before, after));
  }
  return ops;
}
