// SPDX-License-Identifier: Apache-2.0
/**
 * Prefabs: an entity tree in its own document. An entity with the `prefab` component uses it. The instance overrides
 * are ops on the prefab document, with the entity IDs of the prefab. `expandPrefabs` gives the flat tree. The prefab
 * root goes under the instance entity, after its own children. Each prefab entity gets the ID
 * `<instance>/<prefab entity>`. Nested prefabs expand too, with a check for a cycle.
 *
 * A prefab set holds the prefab documents of a page or of a runtime core by their path in the project.
 * `prefabSetResolver` finds the prefab of a source in it. The editor and the runtime use the same functions. Thus the
 * page and the core expand a scene to the same entities.
 */
import type { ComponentRegistry } from "./components/registry";
import { prefabInstanceSchema, type PrefabValue } from "./components/meta";
import { subtreeOf } from "./hierarchy";
import { isObject } from "./json";
import { applyOps } from "./ops/apply";
import { childCount } from "./ops/shared";
import { resolveFrom } from "./paths";
import { formatPointer } from "./pointer";
import type { EntityDocument, PrefabDocument, SceneDocument } from "./schema/documents";
import type { Entity, SceneOp } from "./schema/entity";

/**
 * Find a prefab document by its source. `from` is the source of the prefab that holds the instance (none for the
 * scene).
 */
export type PrefabResolver = (source: string, from: string | undefined) => PrefabDocument | undefined;

export interface PrefabReportEntry {
  /** The ID of the instance entity in the expanded tree. */
  readonly entity: string;
  readonly reason: string;
}

/** The prefab documents of a page or of a core by their path in the project. */
export type PrefabSet = Readonly<Record<string, PrefabDocument>>;

/**
 * The project path of a prefab source: a path relative to the document `from`, or the source file of an asset
 * (`asset:<id>`). Undefined for an asset that `assetPath` does not know.
 */
export function prefabPath(
  source: string,
  from: string,
  assetPath?: (id: string) => string | undefined,
): string | undefined {
  if (source.startsWith("asset:")) return assetPath?.(source.slice("asset:".length));
  return resolveFrom(from, source);
}

/** True when an entity of the document has the `prefab` component. */
export function hasInstances(doc: EntityDocument): boolean {
  return Object.values(doc.entities).some((entity) => entity.components.prefab !== undefined);
}

/**
 * A resolver of `expandPrefabs` over a prefab set. `docPath` is the project path of the scene. A nested source is
 * relative to its holding prefab. `expandPrefabs` gives the source of the holding prefab as `from` and resolves the
 * holding prefab first. Thus the resolver keeps the path of each source that it found.
 */
export function prefabSetResolver(
  set: PrefabSet,
  docPath: string,
  assetPath?: (id: string) => string | undefined,
): PrefabResolver {
  const found = new Map<string, string>();
  return (source, from) => {
    const base = from === undefined ? docPath : (found.get(from) ?? docPath);
    const path = prefabPath(source, base, assetPath);
    if (path === undefined) return undefined;
    found.set(source, path);
    return set[path];
  };
}

/** The prefab component of an entity, or undefined when it has none or the value is bad. */
export function prefabOf(entity: Entity): PrefabValue | undefined {
  const parsed = prefabInstanceSchema.safeParse(entity.components.prefab);
  return parsed.success ? parsed.data : undefined;
}

/** Apply the instance overrides to the prefab. Each op applies alone; a bad op gives a report entry. */
function withOverrides(
  prefab: PrefabDocument,
  ops: readonly SceneOp[],
  registry: ComponentRegistry,
  entity: string,
  report: PrefabReportEntry[],
): PrefabDocument {
  let doc = prefab;
  ops.forEach((op, index) => {
    const result = applyOps(doc, [op], registry);
    if (result.ok) doc = result.doc;
    else report.push({ entity, reason: `override ${String(index)}: ${result.reason}` });
  });
  return doc;
}

interface ExpandContext {
  readonly resolve: PrefabResolver;
  readonly registry: ComponentRegistry;
  readonly report: PrefabReportEntry[];
}

/** The flat entity map of an entity map: each instance gets the entities of its prefab under it. */
function expandMap(
  entities: Readonly<Record<string, Entity>>,
  from: string | undefined,
  chain: readonly string[],
  prefix: string,
  context: ExpandContext,
): Record<string, Entity> {
  const out: Record<string, Entity> = { ...entities };
  for (const [id, entity] of Object.entries(entities)) {
    const value = prefabOf(entity);
    if (value === undefined) {
      if (entity.components.prefab !== undefined)
        context.report.push({ entity: prefix + id, reason: "a bad prefab value" });
      continue;
    }
    const prefab = context.resolve(value.source, from);
    if (prefab === undefined) {
      context.report.push({ entity: prefix + id, reason: `the prefab "${value.source}" was not found` });
      continue;
    }
    if (chain.includes(prefab.id)) {
      context.report.push({
        entity: prefix + id,
        reason: `the prefab "${prefab.id}" holds itself: ${[...chain, prefab.id].join(" > ")}`,
      });
      continue;
    }
    const changed = withOverrides(prefab, value.overrides ?? [], context.registry, prefix + id, context.report);
    const inner = expandMap(changed.entities, value.source, [...chain, prefab.id], `${prefix}${id}/`, context);
    const rootIndex = childCount(entities, id);
    for (const [innerId, innerEntity] of Object.entries(inner)) {
      const parent = innerEntity.parent === null ? id : `${id}/${innerEntity.parent}`;
      const index = innerEntity.parent === null ? rootIndex : innerEntity.index;
      out[`${id}/${innerId}`] = { ...innerEntity, parent, index };
    }
  }
  return out;
}

/**
 * The scene with each prefab instance expanded. The result is not a document to save: its IDs hold `/`. A missing
 * prefab, a cycle or an override that does not apply gives a report entry.
 */
export function expandPrefabs(
  scene: SceneDocument,
  resolve: PrefabResolver,
  registry: ComponentRegistry,
): { doc: SceneDocument; report: PrefabReportEntry[] } {
  const report: PrefabReportEntry[] = [];
  const entities = expandMap(scene.entities, undefined, [], "", { resolve, registry, report });
  return { doc: { ...scene, entities }, report };
}

/** A free entity ID from a wanted ID: the ID, or the ID with `-2`, `-3` and so on. */
function freeId(wanted: string, used: Set<string>): string {
  const base = wanted.slice(0, 60);
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base}-${String(n)}`;
  used.add(id);
  return id;
}

export type UnpackResult =
  | {
      readonly ok: true;
      readonly doc: SceneDocument;
      readonly ops: SceneOp[];
      readonly inverse: SceneOp[];
      /** The new scene ID of each prefab entity. */
      readonly ids: Readonly<Record<string, string>>;
      readonly report: PrefabReportEntry[];
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Unpack an instance: the prefab entities (with the overrides) become plain entities of the scene, with the IDs
 * `<instance>-<prefab entity>`. The instance loses its `prefab` component. A nested instance stays an instance.
 */
export function unpack(
  scene: SceneDocument,
  instance: string,
  resolve: PrefabResolver,
  registry: ComponentRegistry,
): UnpackResult {
  const entity = scene.entities[instance];
  const value = entity === undefined ? undefined : prefabOf(entity);
  if (entity === undefined || value === undefined)
    return { ok: false, reason: `"${instance}" is not a prefab instance` };
  const found = resolve(value.source, undefined);
  if (found === undefined) return { ok: false, reason: `the prefab "${value.source}" was not found` };
  const report: PrefabReportEntry[] = [];
  const prefab = withOverrides(found, value.overrides ?? [], registry, instance, report);
  const used = new Set(Object.keys(scene.entities));
  const order = subtreeOf(prefab.entities, prefab.root);
  const ids = Object.fromEntries(order.map((id) => [id, freeId(`${instance}-${id}`, used)]));
  const ops: SceneOp[] = [{ op: "removeComponent", id: instance, component: "prefab" }];
  for (const id of order) {
    const source = prefab.entities[id];
    if (source === undefined) continue;
    const root = source.parent === null;
    const parent = root ? instance : (ids[source.parent ?? ""] ?? instance);
    const index = root ? childCount(scene.entities, instance) : source.index;
    ops.push({ op: "add", id: ids[id] ?? id, entity: { ...source, parent, index } });
  }
  const result = applyOps(scene, ops, registry);
  if (!result.ok) return { ok: false, reason: `op ${String(result.index)}: ${result.reason}` };
  return { ok: true, doc: result.doc, ops, inverse: result.inverse, ids, report };
}

export type ApplyOverridesResult =
  | { readonly ok: true; readonly prefab: PrefabDocument; readonly scene: SceneDocument; readonly inverse: SceneOp[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Move the overrides of an instance into the prefab document: the result is the new prefab and the scene with no
 * overrides on the instance. Each other instance of the prefab then shows the change too.
 */
export function applyOverridesToPrefab(
  scene: SceneDocument,
  instance: string,
  prefab: PrefabDocument,
  registry: ComponentRegistry,
): ApplyOverridesResult {
  const entity = scene.entities[instance];
  const value = entity === undefined ? undefined : prefabOf(entity);
  if (value === undefined) return { ok: false, reason: `"${instance}" is not a prefab instance` };
  const changed = applyOps(prefab, value.overrides ?? [], registry);
  if (!changed.ok) return { ok: false, reason: `override ${String(changed.index)}: ${changed.reason}` };
  const stored = entity?.components.prefab;
  if (!isObject(stored) || stored.overrides === undefined) {
    return { ok: true, prefab: changed.doc, scene, inverse: [] };
  }
  const path = formatPointer(["entities", instance, "components", "prefab", "overrides"]);
  const cleared = applyOps(scene, [{ op: "set", path }], registry);
  if (!cleared.ok) return { ok: false, reason: cleared.reason };
  return { ok: true, prefab: changed.doc, scene: cleared.doc, inverse: cleared.inverse };
}
