// SPDX-License-Identifier: Apache-2.0
/**
 * The page events of the material editor. The asset browser and the inspector
 * open a material asset with a window event, so they need no part of the material editor: the editor listens to the
 * event in the edit mode. The material editor shows its tab of the bottom dock with the dock tab event.
 */

/** The window event that opens a material asset in the material editor. The detail is `{ ref: "asset:<id>" }`. */
export const MATERIAL_OPEN_EVENT = "scenity:material-open";

/** The window event that shows a tab of the bottom dock. The detail is `{ id: "<tab ID>" }`. */
export const DOCK_TAB_EVENT = "scenity:dock-tab";

/** Ask the material editor of the page to open a material asset. */
export function openMaterial(ref: string): void {
  window.dispatchEvent(new CustomEvent(MATERIAL_OPEN_EVENT, { detail: { ref } }));
}

/** Ask the bottom dock to show a tab. */
export function showDockTab(id: string): void {
  window.dispatchEvent(new CustomEvent(DOCK_TAB_EVENT, { detail: { id } }));
}

/** The text field of the detail of an event, or null. */
export function eventDetail(event: Event, key: string): string | null {
  const detail = (event as CustomEvent<unknown>).detail;
  if (typeof detail !== "object" || detail === null) return null;
  const value = (detail as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}
