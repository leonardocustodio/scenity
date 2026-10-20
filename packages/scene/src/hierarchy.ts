// SPDX-License-Identifier: Apache-2.0
/**
 * The entity tree of a scene or a prefab: the children of a parent in index order, the subtree of an entity and the
 * checks of the tree. In a correct tree, each parent exists and there is no cycle. The indexes of the children of
 * each parent are 0..n-1 with no gap and no repeat.
 */
import type { DocError } from "./errors";
import { formatPointer } from "./pointer";

/** The tree part of an entity: its parent and its index. */
export interface TreeNode {
  readonly parent: string | null;
  readonly index: number;
}

export type TreeEntities = Readonly<Record<string, TreeNode>>;

/** The IDs of the children of a parent (`null` for the roots), in index order, then ID order for a tie. */
export function childrenOf(entities: TreeEntities, parent: string | null): string[] {
  const ids = Object.keys(entities).filter((id) => entities[id]?.parent === parent);
  return ids.sort((a, b) => (entities[a]?.index ?? 0) - (entities[b]?.index ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
}

/** A map from a parent (`""` for the roots) to its children in index order. */
export function childrenMap(entities: TreeEntities): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [id, node] of Object.entries(entities)) {
    const key = node.parent ?? "";
    map.set(key, [...(map.get(key) ?? []), id]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (entities[a]?.index ?? 0) - (entities[b]?.index ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
  }
  return map;
}

/** The entity and all its descendants, parents before children, children in index order. */
export function subtreeOf(entities: TreeEntities, id: string): string[] {
  const map = childrenMap(entities);
  const out: string[] = [];
  const queue = [id];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined || out.includes(next)) continue;
    out.push(next);
    queue.push(...(map.get(next) ?? []));
  }
  return out;
}

/** The ancestors of an entity, from its parent up to its root. A cycle stops the walk. */
export function ancestorsOf(entities: TreeEntities, id: string): string[] {
  const out: string[] = [];
  let parent = entities[id]?.parent ?? null;
  while (parent !== null && !out.includes(parent) && parent !== id) {
    out.push(parent);
    parent = entities[parent]?.parent ?? null;
  }
  return out;
}

/** True when `id` is `ancestor` or one of its descendants. */
export function isInSubtree(entities: TreeEntities, id: string, ancestor: string): boolean {
  return id === ancestor || ancestorsOf(entities, id).includes(ancestor);
}

/** The problems of the tree, with the path of each bad value. `base` is the pointer of the entity map. */
export function checkTree(entities: TreeEntities, base = "/entities"): DocError[] {
  const errors: DocError[] = [];
  for (const [id, node] of Object.entries(entities)) {
    const path = `${base}${formatPointer([id, "parent"])}`;
    if (node.parent === null) continue;
    if (node.parent === id) errors.push({ path, message: `the entity "${id}" is its own parent` });
    else if (!Object.hasOwn(entities, node.parent)) {
      errors.push({ path, message: `the parent "${node.parent}" is not an entity of this document` });
    } else if (ancestorsOf(entities, node.parent).includes(id)) {
      errors.push({ path, message: `the parent "${node.parent}" makes a cycle` });
    }
  }
  for (const [parent, ids] of childrenMap(entities)) {
    ids.forEach((id, expected) => {
      const index = entities[id]?.index;
      if (index === expected) return;
      const under = parent === "" ? "the roots" : `the children of "${parent}"`;
      const message = `the index ${String(index)} is not ${String(expected)}: the indexes of ${under} must be 0..${String(ids.length - 1)}`;
      errors.push({ path: `${base}${formatPointer([id, "index"])}`, message });
    });
  }
  return errors;
}
