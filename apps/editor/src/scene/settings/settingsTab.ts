// SPDX-License-Identifier: Apache-2.0
/**
 * The settings tab of the bottom dock of the scene page. The page loads this module only in the edit mode, so the
 * frames of the gallery do not change. The tab label is a Fluent message of `src/i18n/en-US/settings.ftl`.
 */
import { markRaw } from "vue";
import { t } from "../../texts";
import type { DockTab } from "../assetDock/dockTab";
import SettingsPanel from "./SettingsPanel.vue";
import "./settingsPanel.css";

/** The ID of the settings tab (the `dock.tab` setting can name it). */
export const SETTINGS_TAB = "settings";

/** The dock tab of the settings. `canvas` gets `data-settings="1"` when the tab is ready. */
export function settingsTab(canvas: HTMLCanvasElement): DockTab {
  canvas.dataset.settings = "1";
  return { id: SETTINGS_TAB, label: t("settings-tab"), component: markRaw(SettingsPanel), props: {} };
}
