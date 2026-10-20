// SPDX-License-Identifier: Apache-2.0
/**
 * The keys of the hierarchy tree (the tree pattern of WAI-ARIA): ↑ and ↓ go to the row before
 * and after (Shift extends the selection), Home and End to the first and the last row, → opens a parent or goes to
 * its first child, ← closes a parent or goes to the parent. With Alt the keys move the selected entity: ↑ and ↓ before
 * the sibling before it and after the sibling after it, → into the sibling before it (as its last child), ← out of
 * its parent (after the parent). F2 renames and Delete deletes (page commands). No Vue import.
 */
import type { DropPlace, TreeRow } from "@scenity/editor-core";
import type { SceneDocument } from "@scenity/scene/schema/documents";

/** What a key does. */
export type TreeKeyAction =
  | { readonly kind: "focus"; readonly id: string; readonly extend: boolean }
  | { readonly kind: "expand" | "collapse"; readonly id: string }
  | { readonly kind: "move"; readonly id: string; readonly target: string | null; readonly place: DropPlace };

/** The siblings of an entity in their order (the entities with the same parent, by index). */
export function siblingsOf(doc: SceneDocument, id: string): string[] {
  const parent = doc.entities[id]?.parent ?? null;
  return Object.entries(doc.entities)
    .filter(([, entity]) => entity.parent === parent)
    .sort(([, a], [, b]) => a.index - b.index)
    .map(([key]) => key);
}

/** The move of a key with Alt, or null (no sibling there, or the root). */
function moveAction(doc: SceneDocument, id: string, key: string): TreeKeyAction | null {
  const siblings = siblingsOf(doc, id);
  const at = siblings.indexOf(id);
  const before = siblings[at - 1];
  const after = siblings[at + 1];
  const parent = doc.entities[id]?.parent ?? null;
  if (key === "ArrowUp" && before !== undefined) return { kind: "move", id, target: before, place: "before" };
  if (key === "ArrowDown" && after !== undefined) return { kind: "move", id, target: after, place: "after" };
  if (key === "ArrowRight" && before !== undefined) return { kind: "move", id, target: before, place: "inside" };
  if (key === "ArrowLeft" && parent !== null) return { kind: "move", id, target: parent, place: "after" };
  return null;
}

/** What a key on the row of an entity does, or null for a key that the tree does not take. */
export function treeKey(
  rows: readonly TreeRow[],
  doc: SceneDocument,
  id: string,
  key: string,
  mods: { readonly alt: boolean; readonly shift: boolean },
): TreeKeyAction | null {
  if (mods.alt) return id.includes("/") ? null : moveAction(doc, id, key);
  const at = rows.findIndex((row) => row.id === id);
  const row = rows[at];
  if (row === undefined) return null;
  const focus = (next: TreeRow | undefined): TreeKeyAction | null =>
    next === undefined ? null : { kind: "focus", id: next.id, extend: mods.shift };
  switch (key) {
    case "ArrowDown":
      return focus(rows[at + 1]);
    case "ArrowUp":
      return focus(rows[at - 1]);
    case "Home":
      return focus(rows[0]);
    case "End":
      return focus(rows.at(-1));
    case "ArrowRight":
      if (row.children === 0) return null;
      return row.expanded ? focus(rows[at + 1]) : { kind: "expand", id };
    case "ArrowLeft":
      if (row.children > 0 && row.expanded) return { kind: "collapse", id };
      return focus(rows.find((item) => item.id === row.parent));
    default:
      return null;
  }
}
