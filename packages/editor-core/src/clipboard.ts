// SPDX-License-Identifier: Apache-2.0
/**
 * The clipboard of the editor: copy entities with their subtrees, and paste them as scene ops. A paste gives `add`
 * ops. Thus it is one edit with one undo step, as every other edit. The copies get new IDs from the old IDs (`cart`,
 * `cart-2`, `cart-3`). An entity reference inside the copied entities to another copied entity names the copy. A
 * reference to an entity outside the copy stays. No Vue import.
 */
import { childCount } from "@scenity/scene/ops";
import { ancestorsOf, childrenOf, subtreeOf } from "@scenity/scene/hierarchy";
import { formatRef, parseRef } from "@scenity/scene/refs";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import type { Entity, SceneOp } from "@scenity/scene/schema/entity";

/** The data of a copy: the roots in their order and every copied entity with its old ID. */
export interface ClipboardData {
  readonly format: "scenity.clipboard/1";
  readonly roots: readonly string[];
  readonly entities: Readonly<Record<string, Entity>>;
}

/** Where a paste goes: under a parent (null: the roots of the scene), after its children. */
export interface PasteOptions {
  readonly parent?: string | null;
}

/** The ops of a paste and the new IDs of the roots (the editor selects them). */
export interface Paste {
  readonly ops: SceneOp[];
  readonly roots: string[];
}

/**
 * Copy entities with their subtrees. An entity in the subtree of another copied entity goes in one time, under its
 * parent. An unknown ID is left out. The roots keep the order of the tree.
 */
export function copyEntities(doc: EntityDocument, ids: readonly string[]): ClipboardData {
  const known = [...new Set(ids)].filter((id) => Object.hasOwn(doc.entities, id));
  const roots = known.filter((id) => !ancestorsOf(doc.entities, id).some((parent) => known.includes(parent)));
  const order = treeOrder(doc);
  roots.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const entities: Record<string, Entity> = {};
  for (const root of roots) {
    for (const id of subtreeOf(doc.entities, root)) {
      const entity = doc.entities[id];
      if (entity !== undefined) entities[id] = structuredClone(entity);
    }
  }
  return { format: "scenity.clipboard/1", roots, entities };
}

/** The IDs of the document in the order of the tree (depth first, children in index order). */
function treeOrder(doc: EntityDocument): string[] {
  const out: string[] = [];
  const walk = (parent: string | null): void => {
    for (const id of childrenOf(doc.entities, parent)) {
      out.push(id);
      walk(id);
    }
  };
  walk(null);
  return out;
}

/** A new entity ID from an old one: the old ID without a number suffix, then `-2`, `-3` until it is free. */
export function freeId(base: string, taken: ReadonlySet<string>): string {
  const stem = base.replace(/-[0-9]+$/, "") || base;
  if (!taken.has(stem)) return stem;
  for (let count = 2; ; count += 1) {
    const suffix = `-${String(count)}`;
    const id = `${stem.slice(0, 64 - suffix.length)}${suffix}`;
    if (!taken.has(id)) return id;
  }
}

/** A JSON value with each entity reference to a copied entity changed to the reference of its copy. */
export function remapRefs(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") {
    const ref = parseRef(value);
    if (ref?.kind !== "entity") return value;
    const id = ids.get(ref.id);
    return id === undefined ? value : formatRef({ ...ref, id });
  }
  if (Array.isArray(value)) return value.map((item) => remapRefs(item, ids));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapRefs(item, ids)]));
  }
  return value;
}

/**
 * The ops that paste a copy into a document: one `add` op per entity, parents before children. The roots go after the
 * children of the parent of the paste. A parent that is not in the document gives a paste at the roots.
 */
export function pasteOps(doc: EntityDocument, data: ClipboardData, options: PasteOptions = {}): Paste {
  const wanted = options.parent ?? null;
  const parent = wanted !== null && Object.hasOwn(doc.entities, wanted) ? wanted : null;
  const taken = new Set(Object.keys(doc.entities));
  const ids = new Map<string, string>();
  const order = data.roots.flatMap((root) => subtreeOf(data.entities, root));
  for (const old of order) {
    const id = freeId(old, taken);
    taken.add(id);
    ids.set(old, id);
  }
  let next = childCount(doc.entities, parent);
  const ops: SceneOp[] = order.flatMap((old): SceneOp[] => {
    const entity = data.entities[old];
    const id = ids.get(old);
    if (entity === undefined || id === undefined) return [];
    const root = data.roots.includes(old);
    const copy: Entity = {
      ...entity,
      parent: root ? parent : (ids.get(entity.parent ?? "") ?? parent),
      index: root ? next++ : entity.index,
      components: remapRefs(entity.components, ids) as Entity["components"],
    };
    return [{ op: "add", id, entity: copy }];
  });
  return { ops, roots: data.roots.map((root) => ids.get(root) ?? root) };
}

/** The clipboard of an editor session: the last copy. */
export class Clipboard {
  private data: ClipboardData | null = null;

  /** Copies entities and gives the number of copied entities (with their subtrees). */
  copy(doc: EntityDocument, ids: readonly string[]): number {
    const data = copyEntities(doc, ids);
    this.data = data.roots.length === 0 ? null : data;
    return Object.keys(data.entities).length;
  }

  /** The ops of a paste of the last copy, or null when the clipboard is empty. */
  paste(doc: EntityDocument, options: PasteOptions = {}): Paste | null {
    return this.data === null ? null : pasteOps(doc, this.data, options);
  }

  get empty(): boolean {
    return this.data === null;
  }

  /** The data of the last copy, for the system clipboard. */
  get content(): ClipboardData | null {
    return this.data;
  }
}
