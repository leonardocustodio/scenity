// SPDX-License-Identifier: Apache-2.0
/**
 * The types of the viewport of the scene page: what the viewport reads of the page, and its part of the script API.
 * The viewport itself is a lazy chunk (startViewport.ts).
 */
import type { GhostSpec } from "@scenity/runtime-dev/document/ghostCopies";
import type { OnionCopiesSpec } from "@scenity/runtime-dev/document/onionCopies";
import type { Vec3 } from "@scenity/scene/math";
import type { EditorView } from "@scenity/runtime/protocol";
import type { ScenePanes, SplitLayout } from "@scenity/runtime-dev/document/splitView";
import type { EditorPose } from "../dragMath";
import type { InspectPort } from "../gizmo/freeDrag";
import type { PageSelectionPort } from "../inspector/startInspector";
import type { ScenePageEditor } from "../sceneEditor";

/** A view mode of the viewport. */
export type ViewMode = "lit" | "unlit" | "wireframe" | "normals";

/** The core layer of each view mode ("lit" has none). */
export const VIEW_MODE_LAYERS: Readonly<Record<ViewMode, string | null>> = {
  lit: null,
  unlit: "unlit",
  wireframe: "wireframe",
  normals: "normalShading",
};

/** What the page gives the viewport of its client and its dev tools. */
export interface ViewportPort {
  /** Draw with the editor camera at a view. `userCamera` is true while the user moves it. */
  useEditor(view: EditorView): void;
  /** Draw with a document camera (null: the first camera), as `__scenity.camera`. False when there is no camera. */
  openCamera(name: string | null): Promise<boolean>;
  /** Set the view layers of the viewport (the grid, a view mode). The debug layers of the page do not change. */
  setViewLayers(layers: readonly string[]): Promise<void>;
  /** A picture of the view of a document camera, `width` pixels wide, or null. */
  previewCamera(name: string | null, width: number): Promise<ImageBitmap | null>;
  /** The panes of the split view. */
  setPanes(panes: ScenePanes): void;
  /** The onion skins of an entity (null: none). */
  setOnion?(spec: OnionCopiesSpec | null): void;
  /** The ghosts of the changes that wait (null: none). */
  setGhosts?(spec: GhostSpec | null): void;
  /** Play a clip on an entity at the time of each frame (the clip browser). Null stops it. */
  previewClip?(preview: { readonly entity: string; readonly clip: string; readonly name?: string } | null): void;
}

/** What the viewport reads of the page. */
export interface ViewportParts {
  readonly canvas: HTMLCanvasElement;
  readonly editor: ScenePageEditor;
  readonly selection: PageSelectionPort;
  readonly port: ViewportPort;
  /** The name of the document camera of the page (null: the first camera). */
  camera(): string | null;
  /** The view of the editor camera while it draws, else null. */
  editorView(): EditorPose | null;
  readonly inspect?: InspectPort;
}

/** An icon of a light or a camera on the canvas (CSS pixels from the top left corner of the canvas). */
export interface ViewIcon {
  readonly id: string;
  readonly kind: "light" | "camera";
  readonly x: number;
  readonly y: number;
}

/** The current state of the viewport, for the script API and the tests. */
export interface ViewportInfo {
  /** "editor" while the editor camera draws, else the ID of the document camera that draws. */
  readonly camera: string;
  /** The view that draws: its place, its target (only for the editor camera, else null) and its field of view. */
  readonly position: Vec3 | null;
  readonly target: Vec3 | null;
  readonly fov: number | null;
  /** True while the user moves the editor camera (the frames then use the hysteresis of the levels of detail). */
  readonly moving: boolean;
  readonly viewMode: ViewMode;
  readonly grid: boolean;
  /** The icons that show on the canvas. */
  readonly icons: readonly ViewIcon[];
  /** The document camera of the preview (null when no camera is selected), and the count of its pictures. */
  readonly preview: { readonly camera: string | null; readonly pictures: number };
  /** The projection of the editor camera. */
  readonly projection: "perspective" | "orthographic";
  /** The layout of the split view, and the camera and the view mode of each pane after the main view. */
  readonly split: { readonly layout: SplitLayout; readonly panes: readonly { camera: string; mode: string | null }[] };
}

/** A change of the viewport, as the bar and the keys make it. */
export interface ViewportChange {
  /** "editor", or the ID or the name of a document camera. */
  readonly camera?: string;
  readonly viewMode?: ViewMode;
  readonly grid?: boolean;
  /** The projection of the editor camera, and a view along a world axis (the editor camera draws it). */
  readonly projection?: "perspective" | "orthographic";
  readonly view?: "front" | "back" | "right" | "left" | "top" | "bottom";
  /** The layout of the split view. */
  readonly split?: SplitLayout;
}

/** The viewport part of the script API of the scene page. */
export interface ViewportApi {
  viewport(): ViewportInfo;
  /** Change the camera, the view mode or the grid, and wait for the frame that shows the change. */
  setViewport(change: ViewportChange): Promise<ViewportInfo>;
  /** Frame the selection (the F key) and wait for the frame. With no selection, frame the scene. False: no box. */
  frameSelection(): Promise<boolean>;
}
