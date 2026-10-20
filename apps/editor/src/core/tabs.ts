// SPDX-License-Identifier: Apache-2.0
/**
 * The tabs of the editor plugin (`EditorPlugin.tabs`): a tab of the side panel before the View tab, or a
 * section at the end of the View tab of the core.
 */
import type { Component } from "vue";

export interface EditorTab {
  /** The key of the tab (unique), for example "team". */
  readonly value: string;
  readonly label: string;
  readonly component: Component;
  /** "panel" (default): a tab of the side panel; "view": a section of the View tab. */
  readonly at?: "panel" | "view";
}

/**
 * A tab of the dock under the scene (`EditorPlugin.dockTabs`). The dock gives the state of the content browser
 * to the component as the prop `browser`. The core adds its own tabs after the tabs of the plugin ("Assets").
 */
export interface EditorDockTab {
  /** The key of the tab (unique), for example "clips". */
  readonly value: string;
  readonly label: string;
  readonly component: Component;
}
