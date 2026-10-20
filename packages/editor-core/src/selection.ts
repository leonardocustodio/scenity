// SPDX-License-Identifier: Apache-2.0
/**
 * The selection: a list of selected items, the primary item first. An item of a scene is an entity ID with an optional
 * sub-target (a socket, a path point or a bone). The reference text is `entity:<id>` or `entity:<id>#<sub>`, as a pick
 * result of the runtime names it. A plugin can add its own kinds of items (`SelectionItem`). The functions are pure:
 * each one gives a new selection. No Vue import.
 */
import { formatRef, parseRef } from "@scenity/scene/refs";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import type { SelectionItem } from "./command";

/** An entity of the scene, or a sub-target of it. */
export interface EntityTarget extends SelectionItem {
  readonly kind: "entity";
  readonly id: string;
  /** A socket, a path point (`path.<index>`) or a bone of the entity. */
  readonly sub?: string;
}

/** A selection: the selected items in their order. The first item is the primary item (the card shows it). */
export interface Selection<T extends SelectionItem = EntityTarget> {
  readonly items: readonly T[];
}

export const EMPTY_SELECTION: Selection<never> = { items: [] };

export function entityTarget(id: string, sub?: string): EntityTarget {
  return sub === undefined ? { kind: "entity", id } : { kind: "entity", id, sub };
}

/** The reference text of an entity target: `entity:<id>` or `entity:<id>#<sub>`. */
export function targetRef(target: EntityTarget): string {
  return formatRef(target);
}

/** The entity target of a reference text, or null when the text is not an entity reference. */
export function parseTarget(text: string): EntityTarget | null {
  const ref = parseRef(text.trim());
  if (ref?.kind !== "entity") return null;
  return entityTarget(ref.id, ref.sub);
}

/** True when two items name the same thing (the same kind, ID and sub-target). */
export function sameItem(a: SelectionItem, b: SelectionItem): boolean {
  return a.kind === b.kind && a.id === b.id && (a as { sub?: string }).sub === (b as { sub?: string }).sub;
}

/** The primary item, or null for an empty selection. */
export function primary<T extends SelectionItem>(selection: Selection<T>): T | null {
  return selection.items[0] ?? null;
}

/** Select one item alone, or nothing (null). */
export function selectOnly<T extends SelectionItem>(item: T | null): Selection<T> {
  return { items: item === null ? [] : [item] };
}

/** Add an item at the end (no change when it is in the selection). */
export function addItem<T extends SelectionItem>(selection: Selection<T>, item: T): Selection<T> {
  return selection.items.some((other) => sameItem(other, item)) ? selection : { items: [...selection.items, item] };
}

/** Add an item, or remove it when it is in the selection (Shift+click). */
export function toggleItem<T extends SelectionItem>(selection: Selection<T>, item: T): Selection<T> {
  const without = selection.items.filter((other) => !sameItem(other, item));
  return without.length < selection.items.length ? { items: without } : { items: [...selection.items, item] };
}

/** Make an item the primary item. It moves to the start, and the function adds it when it is not in the selection. */
export function makePrimary<T extends SelectionItem>(selection: Selection<T>, item: T): Selection<T> {
  return { items: [item, ...selection.items.filter((other) => !sameItem(other, item))] };
}

/** The entity IDs of the selection, each one time, in their order (a sub-target selects its entity). */
export function selectedEntities(selection: Selection<SelectionItem>): string[] {
  const ids = selection.items.filter((item) => item.kind === "entity").map((item) => item.id);
  return [...new Set(ids)];
}

/**
 * The selection without the entity items whose entity is not in the document (after a delete, an undo or a reload).
 * The items of other kinds stay.
 */
export function pruneSelection<T extends SelectionItem>(selection: Selection<T>, doc: EntityDocument): Selection<T> {
  const items = selection.items.filter((item) => item.kind !== "entity" || Object.hasOwn(doc.entities, item.id));
  return items.length === selection.items.length ? selection : { items };
}

/** The text of a selection of entities: the references, separated by commas. */
export function selectionText(selection: Selection): string {
  return selection.items.map(targetRef).join(",");
}

/** The selection of a text of references. A part that is not an entity reference is left out. */
export function parseSelectionText(text: string): Selection {
  let selection: Selection = { items: [] };
  for (const part of text.split(",")) {
    const target = parseTarget(part);
    if (target !== null) selection = addItem(selection, target);
  }
  return selection;
}
