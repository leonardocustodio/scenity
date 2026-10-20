// SPDX-License-Identifier: Apache-2.0
/**
 * The asset browser and the tabs of the old bottom dock of the scene page in the edit mode. Each one is a panel of the
 * editor window. The panel "project" is the Project window (its Assets view is the asset browser). The asset browser
 * reads the dev server (the list and the import of scripts/assetApiServer.ts), the open scene ("used by") and the
 * selection of the page. The sequencer, the rules, the material editor and the settings are the panels "timeline",
 * "rules", "material" and "preferences". A panel with no content (a scene with no sequence) tells why. The page loads
 * this module only with `edit=1`, so the frames of the gallery do not change. "Open prefab" of a prefab asset opens it
 * in the prefab mode (prefabs/prefabTools.ts).
 */
import { currentShell } from "../../studio/shell/shell";
import { devServerAssets, type AssetSource } from "../../assetBrowser/assetClient";
import type { PageSelectionPort } from "../inspector/startInspector";
import { DOCK_TAB_EVENT, eventDetail, openMaterial } from "../material/materialEvents";
import { setPanelContent } from "../pageParts";
import type { ScenePageEditor } from "../sceneEditor";
import { prefabActions } from "../prefabs/prefabTools";
import type { DockTab } from "./dockTab";
import PanelNote from "./PanelNote.vue";
import { tabPanel } from "./tabPanels";
import { scenesOf } from "../projects/pageScenes";
import { pageKeys } from "../settings/pageKeys";
import ProjectWindow from "../projectWindow/ProjectWindow.vue";
import { devServerFiles, type ProjectEntry } from "../projectWindow/projectFiles";
import "./assetDock.css";

/** The text of a panel whose part the page does not have. */
const NOTES: Readonly<Record<string, string>> = {
  timeline: "dock-none-timeline",
  rules: "dock-none-rules",
};

/** What the panels read of the page. */
export interface AssetDockStart {
  readonly editor: ScenePageEditor;
  /** The URL of the project folder, with a "/" at the end. */
  readonly base: string;
  readonly scenePath: string;
  readonly selection?: PageSelectionPort | undefined;
  /** The tabs of the page (the sequencer, the rules, the material editor, the settings). */
  readonly tabs?: readonly DockTab[];
}

/** The props of the asset browser. */
function browserProps(parts: AssetDockStart): { readonly source: AssetSource } & Record<string, unknown> {
  const { editor, selection } = parts;
  return {
    source: devServerAssets(parts.base),
    // The path of the active scene (a switch or a save as changes it); a "used by" line opens another scene.
    openScene: () => ({ path: editor.file.path, scene: editor.doc }),
    openDocument: (path: string) => void scenesOf(editor)?.open(path),
    listen: (listener: () => void) => editor.listen(() => listener()),
    ...(selection === undefined ? {} : { selectEntity: (id: string) => selection.set([id]) }),
    openPrefab: (source: string) => {
      const actions = prefabActions(editor);
      const reason = actions === undefined ? "The page has no prefab tools." : actions.openPath(source);
      if (reason !== null) console.warn(reason);
    },
    openMaterial,
    class: "min-h-0 flex-1",
  };
}

/** The props of the Project window. */
function windowProps(parts: AssetDockStart): Record<string, unknown> {
  const { editor, base } = parts;
  const source = devServerAssets(base);
  return {
    files: devServerFiles(base),
    project: /^\/projects\/([^/]+)\//.exec(base)?.[1] ?? "",
    browser: browserProps(parts),
    stills: async () => {
      const list = await source.list();
      return new Map(
        list.assets.flatMap((asset) => (asset.still === null ? [] : [[asset.id, `${base}${asset.still}`]])),
      );
    },
    open: (entry: ProjectEntry) => {
      if (entry.kind === "scene") void scenesOf(editor)?.open(entry.path);
      else if (entry.kind === "material") openMaterial(entry.path);
      else if (entry.kind === "prefab") prefabActions(editor)?.openPath(entry.path);
    },
    create: (command: string) => void pageKeys().run(command),
  };
}

/** Give the asset browser and each tab its panel of the editor window. */
export async function startAssetDock(parts: AssetDockStart): Promise<void> {
  const tabs = parts.tabs ?? [];
  const shown = new Set(tabs.map((tab) => tabPanel(tab.id)));
  await Promise.all([
    // The Project window: the folders of the project and the Assets view (the asset browser).
    setPanelContent("project", { component: ProjectWindow, props: windowProps(parts), hostId: "scene-assets" }),
    ...tabs.map((tab) =>
      setPanelContent(tabPanel(tab.id), {
        component: tab.component,
        props: { ...tab.props, class: "min-h-0 flex-1" },
      }),
    ),
    ...Object.entries(NOTES)
      .filter(([id]) => !shown.has(id))
      .map(([id, text]) => setPanelContent(id, { component: PanelNote, props: { text } })),
  ]);
  // The dock tab event of the page shows a panel (the material editor shows its panel when it opens a material).
  window.addEventListener(DOCK_TAB_EVENT, (event) => {
    const id = eventDetail(event, "id");
    if (id !== null) currentShell()?.showPanel(tabPanel(id));
  });
}
