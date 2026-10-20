// SPDX-License-Identifier: Apache-2.0
/**
 * The tabs of the dock under the scene. First come the tabs of the plugin (`EditorPlugin.dockTabs`, for example the
 * clips and presets of the room), then the core tab "Assets" (the generic asset browser). A function reads the plugin
 * when it runs, never when the module loads. The label of the core tab is a Fluent message of
 * `src/i18n/en-US/browser.ftl`.
 */
import { editorPlugin } from "../plugin";
import type { EditorDockTab } from "../tabs";
import { t } from "../../texts";
import DockAssetsTab from "./DockAssetsTab.vue";

/** The core tab of the asset browser. */
export const ASSETS_TAB: EditorDockTab = { value: "assets", label: t("browser-tab-assets"), component: DockAssetsTab };

/** The tabs of the dock, in their order. */
export function dockTabs(): EditorDockTab[] {
  return [...(editorPlugin().dockTabs ?? []), ASSETS_TAB];
}
