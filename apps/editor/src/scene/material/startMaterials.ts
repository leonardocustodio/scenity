// SPDX-License-Identifier: Apache-2.0
/**
 * The material tab of the bottom dock of the scene page. The page loads this module only in the edit mode, so the
 * frames of the gallery do not change.
 */
import { markRaw } from "vue";
import { t } from "../../texts";
import type { DockTab } from "../assetDock/dockTab";
import type { PageSelectionPort } from "../inspector/startInspector";
import type { ScenePageEditor } from "../sceneEditor";
import MaterialPanel from "./MaterialPanel.vue";
import { MATERIAL_TAB, type PageMaterials } from "./pageMaterials";

/** The dock tab of the material editor over the page editor and the selection of the page. */
export function materialTab(
  materials: PageMaterials,
  editor: ScenePageEditor,
  selection: PageSelectionPort | undefined,
): DockTab {
  return {
    id: MATERIAL_TAB,
    label: t("dock-tab-material"),
    component: markRaw(MaterialPanel),
    // The material editor and the page editor have private fields: a reactive proxy of them cannot read them.
    props: { parts: markRaw({ materials: markRaw(materials), editor: markRaw(editor), selection }) },
  };
}
