// SPDX-License-Identifier: Apache-2.0
/**
 * The panel of each tab of the old bottom dock. The dock tab IDs of the page and of the `dock.tab` setting name panels
 * of the editor window.
 */
export const TAB_PANELS: Readonly<Record<string, string>> = {
  assets: "project",
  sequence: "timeline",
  rules: "rules",
  material: "material",
  settings: "preferences",
};

/** The panel of a dock tab ID. An ID that is already a panel ID does not change. */
export function tabPanel(id: string): string {
  return TAB_PANELS[id] ?? id;
}
