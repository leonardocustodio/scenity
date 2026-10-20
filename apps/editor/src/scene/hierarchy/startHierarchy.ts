// SPDX-License-Identifier: Apache-2.0
/**
 * The hierarchy panel of the scene page in the edit mode. It gives the Vue panel to the panel "hierarchy" of the editor
 * window and connects it to the commands, the editor and the selection of the page. The page loads this module only
 * with `edit=1`, so the frames of the gallery do not change.
 *
 * The panel shows the expanded document (the entities of each prefab instance) and follows each change of the
 * prefab set; its menu opens a prefab through the prefab actions of the page.
 *
 * F2 is the page command `hierarchy.rename` of the key map.
 */
import { t } from "../../texts";
import { setPanelContent } from "../pageParts";
import type { ScenePageEditor } from "../sceneEditor";
import { prefabActions } from "../prefabs/prefabTools";
import { createHierarchy, type HierarchyState } from "./hierarchyState";
import HierarchyPanel from "./HierarchyPanel.vue";
import type { SceneCommands, SelectionPort } from "./sceneCommands";
import "./hierarchy.css";
import { pageKeys } from "../settings/pageKeys";
import { renameCommand } from "./hierarchyKeys";

/** What the panel reads of the page. */
export interface HierarchyParts {
  readonly editor: ScenePageEditor;
  readonly commands: SceneCommands;
  readonly selection: SelectionPort;
  readonly canvas: HTMLCanvasElement;
}

/** Mount the hierarchy panel and connect it to the page. */
export function startHierarchy(parts: HierarchyParts): HierarchyState {
  const { editor } = parts;
  const state = createHierarchy({
    doc: () => editor.expanded,
    view: () => editor.view,
    listen: (listener) => {
      const stopDoc = editor.listen(() => listener());
      const stopView = editor.listenView(() => listener());
      const stopPrefabs = editor.listenPrefabs(() => listener());
      return () => {
        stopDoc();
        stopView();
        stopPrefabs();
      };
    },
    // A command that the scene commands do not have (an item of a plugin) runs from the page registry.
    run: (id, args) =>
      parts.commands.definitions().some((command) => command.id === id)
        ? parts.commands.run(id, args)
        : pageKeys().execute(id, args),
    openPrefab: (id) => {
      const actions = prefabActions(editor);
      return actions === undefined ? t("hierarchy-no-prefab-tools") : actions.open(id);
    },
    selection: parts.selection,
  });
  // The panel "hierarchy" of the editor window; its key context "hierarchy" gives F2 to the rename
  // (settings/pageKeys.ts).
  pageKeys().register([renameCommand(state, parts.selection)]);
  void setPanelContent("hierarchy", { component: HierarchyPanel, props: { state }, hostId: "scene-hierarchy" }).then(
    () => (parts.canvas.dataset.hierarchy = "1"),
  );
  return state;
}
