// SPDX-License-Identifier: Apache-2.0
/**
 * The query of a scene document: the entities that match a filter, with their local and world transforms, their bounds
 * and the values of their components. The tool `scene_query` of the workbench host sends the query to the page of the
 * open scene, and the page answers with this function.
 *
 * The filter has the IDs of `ids`, the subtree of `under`, the text of `where` and the fields `name`, `tag` and
 * `component`. The text of `where` has the search words of the hierarchy panel: `name:`, `tag:`, `component:` or a
 * plain word. All words must match. Each field is a part of the text, with no case. `values` gives the values of all
 * components (true) or of the named ones. The result keeps the tree order and at most `limit` entities (default 50).
 * Pure functions, no DOM.
 */
import type { Quat, Vec3 } from "@scenity/scene/math";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import { localTransform, worldTransform } from "@scenity/scene/world";
import { roundNumber } from "@scenity/scene/canonical";
import { entityMatches, searchTerms, treeOrder, type SearchTerm } from "../hierarchy/tree";

/** A query of the entities of a scene. */
export interface SceneQuery {
  /** The search words of the hierarchy panel, for example `tag:furniture component:shape`. */
  readonly where?: string | undefined;
  /** Only these entity IDs. */
  readonly ids?: readonly string[] | undefined;
  /** A part of the name or the ID. */
  readonly name?: string | undefined;
  /** A part of a tag. */
  readonly tag?: string | undefined;
  /** A part of a component ID. */
  readonly component?: string | undefined;
  /** Only this entity and the entities under it. */
  readonly under?: string | undefined;
  /** The values of each component (true) or of the named components. */
  readonly values?: boolean | readonly string[] | undefined;
  /** The most entities of the result (default 50). */
  readonly limit?: number | undefined;
}

/** A box with the axes of the world. */
export interface QueryBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** A transform: a place, a turn and a scale. */
export interface QueryTransform {
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly scale: Vec3;
}

/** One entity of a query result. */
export interface QueriedEntity {
  readonly id: string;
  readonly name: string | null;
  readonly parent: string | null;
  readonly tags: readonly string[];
  /** The component IDs, in sorted order. */
  readonly components: readonly string[];
  /** The transform in the frame of the parent, or null for an entity with no `transform`. */
  readonly local: QueryTransform | null;
  /** The transform in the world frame, or null when the parent chain is not valid. */
  readonly world: QueryTransform | null;
  /** The world box of the entity and its subtree, or null (no geometry, or no frame of the page yet). */
  readonly bounds: QueryBox | null;
  /** The values of the asked components. */
  readonly values?: Readonly<Record<string, unknown>>;
}

/** The result of a query. */
export interface SceneQueryResult {
  /** The number of entities that match, before the limit. */
  readonly matches: number;
  /** The number of entities in the scene. */
  readonly total: number;
  readonly entities: readonly QueriedEntity[];
}

/** The default limit of a query result. */
export const QUERY_LIMIT = 50;

const round = (values: readonly number[]): number[] => values.map((value) => roundNumber(value));

function transformOf(value: { position: Vec3; rotation: Quat; scale: Vec3 }): QueryTransform {
  return {
    position: round(value.position) as unknown as Vec3,
    rotation: round(value.rotation) as unknown as Quat,
    scale: round(value.scale) as unknown as Vec3,
  };
}

/** The search terms of the fields of a query and of its `where` text. */
function termsOf(query: SceneQuery): SearchTerm[] {
  const fields: SearchTerm[] = [];
  const add = (field: SearchTerm["field"], text: string | undefined): void => {
    const word = text?.trim().toLowerCase() ?? "";
    if (word !== "") fields.push({ field, text: word });
  };
  add("name", query.name);
  add("tag", query.tag);
  add("component", query.component);
  return [...searchTerms(query.where ?? ""), ...fields];
}

/** True when the entity is `root` or under it. */
function isUnder(doc: EntityDocument, id: string, root: string): boolean {
  const seen = new Set<string>();
  for (let next: string | null = id; next !== null && !seen.has(next); next = doc.entities[next]?.parent ?? null) {
    if (next === root) return true;
    seen.add(next);
  }
  return false;
}

/** The asked component values of an entity. */
function valuesOf(components: Readonly<Record<string, unknown>>, asked: SceneQuery["values"]): Record<string, unknown> {
  const names = asked === true ? Object.keys(components).sort() : [...(asked === false ? [] : (asked ?? []))];
  return Object.fromEntries(names.filter((name) => Object.hasOwn(components, name)).map((n) => [n, components[n]]));
}

/** One entity of the result. */
function entityOf(
  doc: EntityDocument,
  id: string,
  query: SceneQuery,
  bounds: (id: string) => QueryBox | null,
): QueriedEntity {
  const entity = doc.entities[id];
  if (entity === undefined) throw new Error(`No entity "${id}".`);
  const world = worldTransform(doc, id);
  const asked = query.values === undefined || query.values === false ? null : query.values;
  return {
    id,
    name: entity.name ?? null,
    parent: entity.parent ?? null,
    tags: [...(entity.tags ?? [])],
    components: Object.keys(entity.components).sort(),
    local: entity.components.transform === undefined ? null : transformOf(localTransform(entity)),
    world: world === undefined ? null : transformOf(world),
    bounds: bounds(id),
    ...(asked === null ? {} : { values: valuesOf(entity.components, asked) }),
  };
}

/**
 * Run a query on a document. `bounds` gives the world box of an entity (the inspect report of the page), or null. An
 * unknown ID of `ids` or `under` is an error that names it.
 */
export function queryScene(
  doc: EntityDocument,
  query: SceneQuery = {},
  bounds: (id: string) => QueryBox | null = () => null,
): SceneQueryResult {
  const missing = [...(query.ids ?? []), ...(query.under === undefined ? [] : [query.under])].filter(
    (id) => !Object.hasOwn(doc.entities, id),
  );
  if (missing.length > 0) throw new Error(`No entity "${missing.join('", "')}" in the scene.`);
  const terms = termsOf(query);
  const ids = query.ids === undefined ? null : new Set(query.ids);
  const order = treeOrder(doc);
  const matched = order.filter(
    (id) =>
      (ids === null || ids.has(id)) &&
      (query.under === undefined || isUnder(doc, id, query.under)) &&
      (terms.length === 0 || entityMatches(doc, id, terms)),
  );
  const limit = Math.max(1, Math.floor(query.limit ?? QUERY_LIMIT));
  return {
    matches: matched.length,
    total: order.length,
    entities: matched.slice(0, limit).map((id) => entityOf(doc, id, query, bounds)),
  };
}
