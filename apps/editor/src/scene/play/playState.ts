// SPDX-License-Identifier: Apache-2.0
/**
 * The play state of the scene page for the pointer of the editor. In the play mode a press on the canvas goes to the
 * input maps of the plugins only (playInput.ts): the click select and the entity drag of the editor do nothing. The
 * gizmo of a selection, the camera and the script API stay. The body has `data-play="1"` while the play mode runs
 * (pagePlay.ts).
 */

/** True while the play mode of the page runs. */
export function playing(): boolean {
  return typeof document !== "undefined" && document.body.dataset.play === "1";
}
