// SPDX-License-Identifier: Apache-2.0
/**
 * The prefab set of an editor page: the prefab documents that the instances of the open document use, by their path
 * in the project (`PrefabSet` of `@scenity/scene`). The set is a channel of the one history. Thus an apply of
 * overrides to a prefab changes the prefab and the scene in one step, and one undo restores both.
 *
 * `PrefabExpander` gives the document with each instance expanded (`expandPrefabs` of `@scenity/scene`). These are the
 * same entities that the runtime core draws and picks, because the core expands the scene with the same functions. The
 * hierarchy and the selection of the page read them. A document with no instance expands to the same object. No Vue
 * import.
 */
import type { ComponentRegistry } from "@scenity/scene/components";
import {
  expandPrefabs,
  hasInstances,
  prefabOf,
  prefabPath,
  prefabSetResolver,
  type PrefabReportEntry,
  type PrefabResolver,
  type PrefabSet,
} from "@scenity/scene";
import type { EntityDocument, PrefabDocument, SceneDocument } from "@scenity/scene/schema/documents";

/** The name of the channel of the prefab set in the history. */
export const PREFAB_CHANNEL = "prefabs";

export { hasInstances, prefabPath, type PrefabSet } from "@scenity/scene";

/** How the page finds the file of a prefab source. */
export interface PrefabPaths {
  /** The path of the open document in the project (the base of a relative source). */
  readonly docPath: string;
  /** The project path of the source file of an asset ID (a source `asset:<id>`), or undefined. */
  readonly assetPath?: (id: string) => string | undefined;
}

/** The end of the name of a prefab file. */
export const PREFAB_SUFFIX = ".prefab.json";

/** The prefab sources that the instances of a document name, in sorted order. */
export function instanceSources(doc: EntityDocument): string[] {
  const out = new Set<string>();
  for (const entity of Object.values(doc.entities)) {
    const source = prefabOf(entity)?.source;
    if (source !== undefined) out.add(source);
  }
  return [...out].sort();
}

/** The project path of the prefab of an instance entity, or undefined when the entity is no instance. */
export function instancePrefabPath(doc: EntityDocument, instance: string, paths: PrefabPaths): string | undefined {
  const entity = doc.entities[instance];
  const value = entity === undefined ? undefined : prefabOf(entity);
  return value === undefined ? undefined : prefabPath(value.source, paths.docPath, paths.assetPath);
}

/** A resolver of `expandPrefabs` over a set (`prefabSetResolver` of `@scenity/scene`). */
export function setResolver(set: PrefabSet, paths: PrefabPaths): PrefabResolver {
  return prefabSetResolver(set, paths.docPath, paths.assetPath);
}

/**
 * Read the prefabs that a document needs, with their nested prefabs. `read` gives the document of a project path, or
 * undefined when the file is missing or does not read. The result has each prefab that `read` found.
 */
export async function loadPrefabSet(
  doc: EntityDocument,
  paths: PrefabPaths,
  read: (path: string) => Promise<PrefabDocument | undefined>,
): Promise<PrefabSet> {
  const out: Record<string, PrefabDocument> = {};
  const tried = new Set<string>();
  let wave: { doc: EntityDocument; path: string }[] = [{ doc, path: paths.docPath }];
  while (wave.length > 0) {
    const next: { doc: EntityDocument; path: string }[] = [];
    for (const item of wave) {
      for (const source of instanceSources(item.doc)) {
        const path = prefabPath(source, item.path, paths.assetPath);
        if (path === undefined || tried.has(path)) continue;
        tried.add(path);
        const prefab = await read(path);
        if (prefab === undefined) continue;
        out[path] = prefab;
        next.push({ doc: prefab, path });
      }
    }
    wave = next;
  }
  return out;
}

/** The expanded document of a page and the problems of the expansion. */
export interface Expansion<D extends EntityDocument> {
  readonly doc: D;
  readonly report: readonly PrefabReportEntry[];
}

/**
 * The expansion of the documents of a page over a prefab set. It keeps the last result for each document object, so
 * a document and a set that do not change cost nothing.
 */
export class PrefabExpander {
  readonly #cache = new WeakMap<object, { readonly set: PrefabSet; readonly result: Expansion<EntityDocument> }>();

  constructor(
    readonly paths: PrefabPaths,
    readonly registry: ComponentRegistry,
  ) {}

  /** The document with each instance expanded. The same object when the document has no instance. */
  expand<D extends EntityDocument>(doc: D, set: PrefabSet): D {
    return this.expansion(doc, set).doc;
  }

  /** The expanded document and the report of the missing prefabs, the cycles and the overrides that do not apply. */
  expansion<D extends EntityDocument>(doc: D, set: PrefabSet): Expansion<D> {
    if (!hasInstances(doc)) return { doc, report: [] };
    const known = this.#cache.get(doc);
    if (known?.set === set) return known.result as Expansion<D>;
    // `expandPrefabs` reads only the entity map. Thus a prefab document (the prefab mode of the page) also expands.
    const result = expandPrefabs(doc as SceneDocument, setResolver(set, this.paths), this.registry);
    const expansion = { doc: result.doc as unknown as D, report: result.report };
    this.#cache.set(doc, { set, result: expansion });
    return expansion;
  }
}
