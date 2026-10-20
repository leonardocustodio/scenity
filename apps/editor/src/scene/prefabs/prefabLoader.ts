// SPDX-License-Identifier: Apache-2.0
/**
 * The prefabs of new instances: after an edit, each prefab that an instance of the document names and the prefab set
 * does not have yet (a create of a prefab instance, a paste, an agent command) loads from its file with its nested
 * prefabs, and goes into the set with no step of the history. A file that does not read loads once only; the report of
 * the expansion names its instances.
 */
import { instancePrefabPath, loadPrefabSet, type PrefabSet } from "@scenity/editor-core";
import type { ScenePageEditor } from "../sceneEditor";
import type { PagePrefabs } from "./pagePrefabs";

/** Load the prefabs of the new instances of the document after each edit. */
export function startPrefabLoader(editor: ScenePageEditor, loaded: Pick<PagePrefabs, "read">): void {
  const tried = new Set<string>();
  let busy = false;
  const check = async (): Promise<void> => {
    const paths = editor.expander?.paths;
    if (paths === undefined || busy) return;
    const doc = editor.doc;
    const missing = Object.keys(doc.entities)
      .map((id) => instancePrefabPath(doc, id, paths))
      .filter((path): path is string => path !== undefined && editor.prefabs[path] === undefined && !tried.has(path));
    if (missing.length === 0) return;
    busy = true;
    try {
      for (const path of missing) tried.add(path);
      // The set of the document with each prefab that the page has, and a read of the others (with the nested ones).
      const known = editor.prefabs;
      const set: PrefabSet = await loadPrefabSet(doc, paths, (path) =>
        known[path] === undefined ? loaded.read(path) : Promise.resolve(known[path]),
      );
      const added = Object.fromEntries(Object.entries(set).filter(([path]) => known[path] === undefined));
      if (Object.keys(added).length > 0) editor.usePrefabs(added);
    } finally {
      busy = false;
    }
  };
  editor.listen(() => void check());
}
