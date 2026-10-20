// SPDX-License-Identifier: Apache-2.0
/**
 * The entity tree of the hierarchy panel: the rows of a scene document in tree order (the `parent` and `index` of each
 * entity), the collapsed parents, the search by name, tag or component, and the drop place of a drag. The functions
 * are pure. No Vue import.
 */
import { childrenMap, isInSubtree } from "@scenity/scene/hierarchy";
import type { EntityDocument } from "@scenity/scene/schema/documents";

/** One row of the tree. */
export interface TreeRow {
  readonly id: string;
  /** The name of the entity, or its ID when it has no name. */
  readonly label: string;
  /** 0 for a root entity. */
  readonly depth: number;
  readonly parent: string | null;
  readonly index: number;
  /** The number of child entities. */
  readonly children: number;
  /** True when the rows of the children show. */
  readonly expanded: boolean;
  /** True when the entity matches the search. An ancestor of a match shows with false. */
  readonly match: boolean;
}

export interface TreeOptions {
  /** The parents whose children do not show. A search shows each parent of a match. */
  readonly collapsed?: ReadonlySet<string>;
  /** The search text (searchTerms). An empty text shows all entities. */
  readonly query?: string;
}

/** The text of a row: the name of the entity, or its ID. */
export function entityLabel(doc: EntityDocument, id: string): string {
  return doc.entities[id]?.name ?? id;
}

/** One term of a search: a field and a text in lower case. */
export interface SearchTerm {
  readonly field: "any" | "name" | "tag" | "component";
  readonly text: string;
}

const PREFIXES: Readonly<Record<string, SearchTerm["field"]>> = {
  name: "name",
  tag: "tag",
  t: "tag",
  component: "component",
  c: "component",
};

/**
 * The terms of a search text. The words are separated by spaces. A word can have a prefix: `name:`, `tag:` (or `t:`)
 * and `component:` (or `c:`). A word with no prefix matches the name, the ID, a tag or a component ID.
 */
export function searchTerms(query: string): SearchTerm[] {
  const out: SearchTerm[] = [];
  for (const word of query.trim().toLowerCase().split(/\s+/)) {
    if (word === "") continue;
    const colon = word.indexOf(":");
    const field = colon > 0 ? PREFIXES[word.slice(0, colon)] : undefined;
    const text = field === undefined ? word : word.slice(colon + 1);
    if (text !== "") out.push({ field: field ?? "any", text });
  }
  return out;
}

/** True when the entity matches each term of the search. */
export function entityMatches(doc: EntityDocument, id: string, terms: readonly SearchTerm[]): boolean {
  const entity = doc.entities[id];
  if (entity === undefined) return false;
  const name = [id, entity.name ?? ""].map((text) => text.toLowerCase());
  const tags = (entity.tags ?? []).map((tag) => tag.toLowerCase());
  const components = Object.keys(entity.components).map((component) => component.toLowerCase());
  const has = (list: readonly string[], text: string): boolean => list.some((item) => item.includes(text));
  return terms.every((term) => {
    switch (term.field) {
      case "name":
        return has(name, term.text);
      case "tag":
        return has(tags, term.text);
      case "component":
        return has(components, term.text);
      case "any":
        return has(name, term.text) || has(tags, term.text) || has(components, term.text);
    }
  });
}

/** The IDs of the entities that match a search text, in tree order. An empty text matches no entity. */
export function searchEntities(doc: EntityDocument, query: string): string[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  return treeOrder(doc).filter((id) => entityMatches(doc, id, terms));
}

/** The IDs of all entities in tree order: each parent before its children, the children in index order. */
export function treeOrder(doc: EntityDocument): string[] {
  const map = childrenMap(doc.entities);
  const out: string[] = [];
  const walk = (key: string): void => {
    for (const id of map.get(key) ?? []) {
      out.push(id);
      walk(id);
    }
  };
  walk("");
  return out;
}

/** The entities that a search shows: the matches and their ancestors, or null for no search. */
function searchShows(doc: EntityDocument, query: string): { shown: Set<string>; matches: Set<string> } | null {
  if (searchTerms(query).length === 0) return null;
  const matches = new Set(searchEntities(doc, query));
  const shown = new Set<string>();
  for (const id of matches) {
    for (let next: string | null = id; next !== null && !shown.has(next); next = doc.entities[next]?.parent ?? null) {
      shown.add(next);
    }
  }
  return { shown, matches };
}

/** The rows of the tree that show. The children of a collapsed parent do not show. */
export function treeRows(doc: EntityDocument, options: TreeOptions = {}): TreeRow[] {
  const map = childrenMap(doc.entities);
  const search = searchShows(doc, options.query ?? "");
  const collapsed = options.collapsed ?? new Set<string>();
  const rows: TreeRow[] = [];
  const walk = (key: string, depth: number): void => {
    for (const id of map.get(key) ?? []) {
      if (search !== null && !search.shown.has(id)) continue;
      const entity = doc.entities[id];
      if (entity === undefined) continue;
      const children = map.get(id)?.length ?? 0;
      const expanded = children > 0 && (search !== null || !collapsed.has(id));
      const match = search === null || search.matches.has(id);
      rows.push({
        id,
        label: entity.name ?? id,
        depth,
        parent: entity.parent,
        index: entity.index,
        children,
        expanded,
        match,
      });
      if (expanded) walk(id, depth + 1);
    }
  };
  walk("", 0);
  return rows;
}

/** The IDs of the rows from one row to another row, both included, in the order of the rows. */
export function rowRange(rows: readonly TreeRow[], from: string, to: string): string[] {
  const a = rows.findIndex((row) => row.id === from);
  const b = rows.findIndex((row) => row.id === to);
  if (b < 0) return [];
  if (a < 0) return [to];
  return rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((row) => row.id);
}

/** Where a drop goes on a row: before it, after it (as siblings), or inside it (as its last child). */
export type DropPlace = "before" | "after" | "inside";

/**
 * The new place of the moved entities: the parent (null for the roots) and the index of the first moved entity in
 * the children of the parent without the moved entities.
 */
export interface DropTarget {
  readonly parent: string | null;
  readonly index: number;
}

/** True when the parent can take the entities: the parent is not one of them or in a subtree of one of them. */
export function canParent(doc: EntityDocument, ids: readonly string[], parent: string | null): boolean {
  if (parent !== null && !Object.hasOwn(doc.entities, parent)) return false;
  return parent === null || ids.every((id) => !isInSubtree(doc.entities, parent, id));
}

/**
 * The target of a drop of entities on a row (`target` null: the end of the roots), or null when the drop makes a
 * cycle in the tree or names an entity that does not exist.
 */
export function dropTarget(
  doc: EntityDocument,
  ids: readonly string[],
  target: string | null,
  place: DropPlace,
): DropTarget | null {
  if (ids.length === 0 || ids.some((id) => !Object.hasOwn(doc.entities, id))) return null;
  const row = target === null ? undefined : doc.entities[target];
  if (target !== null && row === undefined) return null;
  const parent = target === null ? null : place === "inside" ? target : (row?.parent ?? null);
  if (!canParent(doc, ids, parent)) return null;
  if (place !== "inside" && target !== null && ids.includes(target)) return null;
  const siblings = (childrenMap(doc.entities).get(parent ?? "") ?? []).filter((id) => !ids.includes(id));
  if (target === null || place === "inside") return { parent, index: siblings.length };
  const at = siblings.indexOf(target);
  return { parent, index: place === "before" ? at : at + 1 };
}

/** The entities of a list whose ancestors are not in the list, in the order of the list (a subtree moves as one). */
export function topEntities(doc: EntityDocument, ids: readonly string[]): string[] {
  const set = new Set(ids);
  return [...set].filter((id) => {
    if (!Object.hasOwn(doc.entities, id)) return false;
    for (let next = doc.entities[id]?.parent ?? null; next !== null; next = doc.entities[next]?.parent ?? null) {
      if (set.has(next)) return false;
      if (next === id) break;
    }
    return true;
  });
}
