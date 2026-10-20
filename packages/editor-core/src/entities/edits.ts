// SPDX-License-Identifier: Apache-2.0
/**
 * The scene ops of the entity edits: add, duplicate, delete and paste. Each function gives the ops of one edit. Thus
 * the history keeps one undo step for it. The copies get new IDs from the old IDs (`freeId` of clipboard.ts). An entity
 * reference inside the copies to another copied entity names the copy. The rule of the references to entities that go
 * is in refs.ts. Pure functions. No Vue import.
 */
import { roundNumber } from "@scenity/scene/canonical";
import { subtreeOf } from "@scenity/scene/hierarchy";
import { childCount } from "@scenity/scene/ops";
import { parseRef } from "@scenity/scene/refs";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import type { Entity, SceneOp } from "@scenity/scene/schema/entity";
import { freeId, pasteOps, remapRefs, type ClipboardData, type PasteOptions } from "../clipboard";
import { topEntities, treeOrder } from "../hierarchy/tree";
import { clearedComponents, clearOps, lostRefs, refsInto, withComponents, type LostRef } from "./refs";

/** The ops of an edit that adds entities, the IDs of the new roots (the editor selects them), and the cleared refs. */
export interface EntityEdit {
  readonly ops: SceneOp[];
  readonly roots: string[];
  readonly cleared: readonly LostRef[];
}

/** What a new entity gets: a name, a parent, a place and the asset of its `model` component. */
export interface NewEntity {
  /** The base of the new ID (default: from the name or the asset, else "entity"). */
  readonly id?: string;
  readonly name?: string;
  readonly parent?: string | null;
  /** The position in the frame of the parent (the world for a root entity), metres. */
  readonly position?: readonly [number, number, number];
  /** An asset reference `asset:<id>`, or an asset ID: the entity gets a `model` component with it. */
  readonly asset?: string;
}

/** An ID base from a text: lower case, words joined by "-", only the characters of an entity ID. */
export function idBase(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base === "" ? "entity" : base;
}

/** The asset reference of an `asset` value: `asset:<id>` stays, and a bare ID gets the prefix. Null when not valid. */
export function assetRefOf(value: string): string | null {
  const text = value.trim();
  const ref = parseRef(text.startsWith("asset:") ? text : `asset:${text}`);
  return ref?.kind === "asset" ? `asset:${ref.id}` : null;
}

/** The op that adds one new entity at the end of the children of its parent. */
export function addEntityOps(doc: EntityDocument, entity: NewEntity): EntityEdit {
  const parent = entity.parent ?? null;
  const asset = entity.asset === undefined ? null : assetRefOf(entity.asset);
  if (entity.asset !== undefined && asset === null) throw new Error(`"${entity.asset}" is not an asset reference.`);
  const base = idBase(entity.id ?? entity.name ?? (asset === null ? "entity" : "model"));
  const id = freeId(base, new Set(Object.keys(doc.entities)));
  const position = (entity.position ?? [0, 0, 0]).map((value) => roundNumber(value));
  const components: Entity["components"] = { transform: { position } };
  if (asset !== null) components.model = { asset };
  const name = entity.name?.trim() ?? "";
  const added: Entity = {
    ...(name === "" ? {} : { name }),
    parent,
    index: childCount(doc.entities, parent),
    components,
  };
  return { ops: [{ op: "add", id, entity: added }], roots: [id], cleared: [] };
}

/**
 * The ops of a duplicate: a copy of each entity (with its subtree) right after it under the same parent. A selected
 * entity under another selected entity goes with its ancestor. A reference inside the copies to a copied entity names
 * the copy. A reference to another entity stays.
 */
export function duplicateOps(doc: EntityDocument, ids: readonly string[]): EntityEdit {
  const order = treeOrder(doc);
  const roots = topEntities(doc, ids).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const taken = new Set(Object.keys(doc.entities));
  const map = new Map<string, string>();
  for (const old of roots.flatMap((root) => subtreeOf(doc.entities, root))) {
    const id = freeId(old, taken);
    taken.add(id);
    map.set(old, id);
  }
  // The roots of one parent go from the highest index to the lowest. Thus an add does not move the index of a lower
  // sibling.
  const placed = [...roots].sort((a, b) => (doc.entities[b]?.index ?? 0) - (doc.entities[a]?.index ?? 0));
  const ops: SceneOp[] = placed.flatMap((root) =>
    subtreeOf(doc.entities, root).flatMap((old): SceneOp[] => {
      const entity = doc.entities[old];
      const id = map.get(old);
      if (entity === undefined || id === undefined) return [];
      const top = old === root;
      const copy: Entity = {
        ...structuredClone(entity),
        parent: top ? entity.parent : (map.get(entity.parent ?? "") ?? entity.parent),
        index: top ? entity.index + 1 : entity.index,
        components: remapRefs(entity.components, map) as Entity["components"],
      };
      return [{ op: "add", id, entity: copy }];
    }),
  );
  return { ops, roots: roots.map((root) => map.get(root) ?? root), cleared: [] };
}

/** The ops of a delete and the references to the deleted entities that the ops clear. */
export interface DeleteEdit {
  readonly ops: SceneOp[];
  /** The deleted entities with their subtrees. */
  readonly gone: readonly string[];
  readonly refs: readonly LostRef[];
}

/**
 * The ops of a delete: the entities and their subtrees. First the ops that clear the references of the other entities
 * to them (refs.ts), then one `remove` op per top entity.
 */
export function deleteOps(doc: EntityDocument, ids: readonly string[]): DeleteEdit {
  const roots = topEntities(doc, ids);
  const gone = new Set(roots.flatMap((root) => subtreeOf(doc.entities, root)));
  const refs = refsInto(doc, gone);
  const ops: SceneOp[] = [...clearOps(doc.entities, refs), ...roots.map((id): SceneOp => ({ op: "remove", id }))];
  return { ops, gone: [...gone], refs };
}

/**
 * The ops of a paste of a copy (clipboard.ts) into a document, maybe of another scene of the project. The asset
 * references stay. A reference to an entity that is not in the document after the paste (a copy from another scene)
 * goes, as in a delete (refs.ts). The result names each one.
 */
export function pasteEdit(doc: EntityDocument, data: ClipboardData, options: PasteOptions = {}): EntityEdit {
  const paste = pasteOps(doc, data, options);
  const added: Record<string, Entity> = {};
  for (const op of paste.ops) if (op.op === "add") added[op.id] = op.entity;
  const known = (id: string): boolean => Object.hasOwn(doc.entities, id) || Object.hasOwn(added, id);
  const lost = lostRefs(added, (id) => !known(id));
  if (lost.length === 0) return { ops: paste.ops, roots: paste.roots, cleared: [] };
  // The clear goes into the added entities. Thus the paste stays one add op per entity.
  const parts = clearedComponents(added, lost);
  const ops = paste.ops.map((op): SceneOp => {
    const change = op.op === "add" ? parts.get(op.id) : undefined;
    return op.op !== "add" || change === undefined ? op : { ...op, entity: withComponents(op.entity, change) };
  });
  return { ops, roots: paste.roots, cleared: lost };
}

/** The new roots of a list of ops: the IDs of the `add` ops whose parent is not an added entity. */
export function addedRoots(ops: readonly SceneOp[]): string[] {
  const added = new Set(ops.flatMap((op) => (op.op === "add" ? [op.id] : [])));
  return ops.flatMap((op) => (op.op === "add" && !added.has(op.entity.parent ?? "") ? [op.id] : []));
}
