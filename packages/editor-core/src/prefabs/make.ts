// SPDX-License-Identifier: Apache-2.0
/**
 * Make a prefab from the selection: the prefab document of the selected entities with their subtrees, and the scene
 * ops that put one instance of it in their place. One root entity is the root of the prefab (at the origin of the
 * prefab). More roots go under a new root entity at the middle of their places. Their places in the prefab are their
 * places from that middle. The instance takes the place of the root (or of the middle) under the
 * same parent. The roots must have the same parent. No Vue import.
 */
import { roundNumber } from "@scenity/scene/canonical";
import { subtreeOf } from "@scenity/scene/hierarchy";
import type { EntityDocument, PrefabDocument } from "@scenity/scene/schema/documents";
import type { Entity, SceneOp } from "@scenity/scene/schema/entity";
import { childCount } from "@scenity/scene/ops";
import { resolveFrom } from "@scenity/scene/paths";
import { topEntities, treeOrder } from "../hierarchy/tree";
import { EditError } from "../ops";

/** The result of a make: the prefab, the scene ops and the ID of the instance. */
export interface MadePrefab {
  readonly prefab: PrefabDocument;
  readonly ops: readonly SceneOp[];
  readonly instance: string;
}

type Vec3 = [number, number, number];

/** The local place of an entity (the origin when it has no transform). */
function placeOf(entity: Entity): Vec3 {
  const transform = entity.components.transform as { position?: unknown } | undefined;
  const position = Array.isArray(transform?.position) ? (transform.position as unknown[]) : [];
  return [0, 1, 2].map((axis) => (typeof position[axis] === "number" ? position[axis] : 0)) as Vec3;
}

/** The entity with a new local place. */
function placed(entity: Entity, position: Vec3, parent: string | null, index: number): Entity {
  const transform = { ...(entity.components.transform as Record<string, unknown> | undefined), position };
  return { ...entity, parent, index, components: { ...entity.components, transform } };
}

/** A free entity ID from a wanted ID. */
function freeId(wanted: string, used: ReadonlySet<string>): string {
  let id = wanted;
  for (let n = 2; used.has(id); n += 1) id = `${wanted}-${String(n)}`;
  return id;
}

/** The slug of a name for an ID: lower case words with `-`. */
function slug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "prefab"
  );
}

/**
 * The prefab of the selected entities and the ops of its instance in their place. `source` is the value of the
 * `prefab.source` of the instance (a path from the scene file, or `asset:<id>`). `rebase` gives the source of a nested
 * instance from the prefab file.
 */
export function makePrefab(
  doc: EntityDocument,
  selected: readonly string[],
  name: string,
  source: string,
  rebase: (source: string) => string = (same) => same,
): MadePrefab {
  const order = treeOrder(doc);
  const roots = topEntities(doc, selected).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const first = roots[0] === undefined ? undefined : doc.entities[roots[0]];
  if (first === undefined) throw new EditError("Select the entities of the prefab first.");
  const parent = first.parent;
  if (roots.some((id) => doc.entities[id]?.parent !== parent))
    throw new EditError("The entities of a prefab need the same parent.");
  const id = slug(name);
  const entities: Record<string, Entity> = {};
  let root: string;
  let place: Vec3;
  if (roots.length === 1 && roots[0] !== undefined) {
    root = roots[0];
    place = placeOf(first);
  } else {
    // A new root at the middle of the places of the roots. Each root keeps its place from the middle.
    const places = roots.map((each) => placeOf(doc.entities[each] ?? first));
    place = [0, 1, 2].map((axis) =>
      roundNumber(places.reduce((sum, item) => sum + (item[axis] ?? 0), 0) / places.length),
    ) as Vec3;
    root = freeId(id, new Set(Object.keys(doc.entities)));
    entities[root] = { name, parent: null, index: 0, components: { transform: { position: [0, 0, 0] } } };
  }
  roots.forEach((each, at) => {
    for (const member of subtreeOf(doc.entities, each)) {
      const entity = doc.entities[member];
      if (entity === undefined) continue;
      if (member === root) entities[member] = placed(entity, [0, 0, 0], null, 0);
      else if (member === each) {
        const local = placeOf(entity).map((value, axis) => roundNumber(value - (place[axis] ?? 0))) as Vec3;
        entities[member] = placed(entity, local, root, at);
      } else entities[member] = entity;
    }
  });
  for (const [member, entity] of Object.entries(entities)) {
    const nested = entity.components.prefab as { source?: unknown } | undefined;
    if (typeof nested?.source !== "string") continue;
    const prefab = { ...nested, source: rebase(nested.source) };
    entities[member] = { ...entity, components: { ...entity.components, prefab } };
  }
  const prefab: PrefabDocument = { format: "scenity.prefab/1", id, name, root, entities };
  const removed = new Set(roots.flatMap((each) => subtreeOf(doc.entities, each)));
  const instance = freeId(id, new Set(Object.keys(doc.entities).filter((key) => !removed.has(key))));
  // The roots go from the last to the first. Thus the index of each other entity stays valid until its own remove.
  const removes: SceneOp[] = [...roots].reverse().map((each) => ({ op: "remove", id: each }));
  const left = Object.fromEntries(Object.entries(doc.entities).filter(([key]) => !removed.has(key)));
  const add: SceneOp = {
    op: "add",
    id: instance,
    entity: {
      name,
      parent,
      index: childCount(left, parent),
      components: { transform: { position: place }, prefab: { source } },
    },
  };
  return { prefab, ops: [...removes, add], instance };
}

/** The path of a project file from the folder of another project file (`scenes/main.scene.json` → `../prefabs/a`). */
export function relativePath(from: string, to: string): string {
  const base = from.split("/").slice(0, -1);
  const target = to.split("/");
  let same = 0;
  while (same < base.length && same < target.length - 1 && base[same] === target[same]) same += 1;
  return [...base.slice(same).map(() => ".."), ...target.slice(same)].join("/");
}

/** The source of an instance from another document. A path names the same file, and an asset stays. */
export function rebasedSource(source: string, from: string, to: string): string {
  return source.startsWith("asset:") ? source : relativePath(to, resolveFrom(from, source));
}

/**
 * A variant of a prefab: a prefab with one root, an instance of the base prefab (`source`, from the variant file) with
 * the overrides of the variant.
 */
export function makeVariant(name: string, source: string, overrides: readonly SceneOp[] = []): PrefabDocument {
  const id = slug(name);
  const prefab = { source, ...(overrides.length === 0 ? {} : { overrides: [...overrides] }) };
  const root: Entity = { name, parent: null, index: 0, components: { transform: { position: [0, 0, 0] }, prefab } };
  return { format: "scenity.prefab/1", id, name, root: id, entities: { [id]: root } };
}
