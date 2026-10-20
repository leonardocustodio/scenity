// SPDX-License-Identifier: Apache-2.0
/**
 * The split view of the editor Scene view: 1, 2 or 4 views on one canvas, each with its own camera and view mode. The
 * main view is pane 0 at the top left corner (panes.ts), so a point of the canvas in it is also a point of the main
 * view: the picks and the gizmos of the page stay in the main view. Each other pane draws the editor camera at its own
 * view, or a document camera, with its own shading mode. This module is plain data: the page, the client and the dev
 * document core all use it.
 */
import type { EditorView } from "@scenity/runtime/protocol";
import type { PaneLayout } from "../panes";

/** The layouts of the split view: 1 view, 2 side by side, 2 stacked, 4 in a 2 × 2 grid. */
export const SPLIT_LAYOUTS = ["1", "2h", "2v", "2x2"] as const satisfies readonly PaneLayout[];
export type SplitLayout = (typeof SPLIT_LAYOUTS)[number];

/** The view modes of a pane: null is the lit mode. */
export const PANE_MODES = ["unlit", "normalShading", "wireframe"] as const;
export type PaneMode = (typeof PANE_MODES)[number];

/** A pane after the main one. */
export interface ScenePane {
  /** The view of the editor camera, or null for the document camera of `camera`. */
  readonly view: EditorView | null;
  /** The ID or name of the document camera when `view` is null (null: the first one). */
  readonly camera: string | null;
  /** The view mode, or null for the lit mode. */
  readonly mode: PaneMode | null;
}

/** The panes of the split view. The main view keeps the camera and the layers of the page. */
export interface ScenePanes {
  readonly layout: SplitLayout;
  /** The panes after the main one, in the order of the layout. */
  readonly others: readonly ScenePane[];
}

/** The panes of one view. */
export const SINGLE_VIEW: ScenePanes = { layout: "1", others: [] };

/** True for a layout of the split view. */
export function isSplitLayout(value: unknown): value is SplitLayout {
  return typeof value === "string" && (SPLIT_LAYOUTS as readonly string[]).includes(value);
}

/** A plain copy of the panes for a message (no proxy of the page). */
export function plainScenePanes(panes: ScenePanes): ScenePanes {
  return {
    layout: panes.layout,
    others: panes.others.map((pane) => ({
      view:
        pane.view === null
          ? null
          : { position: [...pane.view.position], target: [...pane.view.target], fov: pane.view.fov },
      camera: pane.camera,
      mode: pane.mode,
    })),
  };
}
