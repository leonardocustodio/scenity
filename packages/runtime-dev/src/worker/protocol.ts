// SPDX-License-Identifier: Apache-2.0
/**
 * The messages of the dev worker in addition to the runtime protocol. The runtime worker does not know them. The dev
 * worker of a plugin handles them (extension.ts).
 */
import type { CameraView } from "@scenity/runtime/framing";
import type { GhostSpec, GhostView } from "../ghosts";
import type { HideSpec } from "../hideSpec";
import type { OnionSpec, OnionView } from "../onion";
import type { OverlaySpec, OverlayView, PropBox } from "../overlay";
import type { FrameCapture, InspectReport } from "../inspect";
import type { CaptureTarget, PaneViews } from "../panes";
import type { PickResult, SelectTarget } from "../pickMath";
import type { PreviewModel } from "../preview";
import type { ScratchUpdate } from "../scratch";
import type { CaptureCheck } from "../readback";
import type { IndexShot, ShotRequest } from "../shots";
import type { SweepSample } from "../sweep";

/** The fields of the "init" message that the dev worker reads. */
export interface DevInit {
  /** A fixed camera in place of the framing, or null. */
  readonly view?: CameraView | null;
  /** The count of asset loads at the same time; absent: the value of the runtime. */
  readonly loads?: number;
  /** The panes of the split screen at the start; absent: one pane. */
  readonly panes?: PaneViews | null;
}

export type DevToWorker =
  /** A fixed camera of the main pane, or null for the framing of the plugin core. */
  | { readonly type: "view"; readonly view: CameraView | null }
  /**
   * The layout of the split screen and the camera of each pane, the main pane first: one update per frame, then a
   * viewport and a scissor per pane.
   */
  | {
      readonly type: "views";
      readonly layout: PaneViews["layout"];
      readonly views: PaneViews["views"];
      readonly hideDebug?: PaneViews["hideDebug"];
      /** The own tune values of each pane (a layout variant), or null. */
      readonly tunes?: PaneViews["tunes"];
    }
  /** Draw a frame immediately and answer "drawn" after it (the lab and its tools wait for a frame at a time). */
  | { readonly type: "mark"; readonly id: number }
  /** The debug layers over the scene. */
  | { readonly type: "debug"; readonly layers: readonly string[] }
  /** Answer "inspected" with the report of the last frame. */
  | { readonly type: "inspect"; readonly id: number }
  /** The tune values: each other tuned number returns to its default. */
  | { readonly type: "tune"; readonly values: Readonly<Record<string, number>>; readonly quick?: boolean }
  /**
   * Draw a frame immediately and answer "captured" with a picture of it and the clips of the members (for the content
   * browser). A `height` above 0 draws the picture at that size and aspect, not at the aspect of the canvas.
   */
  | {
      readonly type: "capture";
      readonly id: number;
      readonly width: number;
      readonly height?: number;
      /** One pane (default: the main pane) or the whole canvas with all its panes. */
      readonly target?: CaptureTarget;
    }
  /**
   * The clock of the page is stopped (true) or runs (false), after a new clock sample. A stopped clock stops the frame
   * loop until the next change. Each message draws one frame (a seek).
   */
  | { readonly type: "clockStopped"; readonly stopped: boolean }
  /**
   * What is under a point of the canvas (CSS pixels) in a pane, from the last frame; answer "picked" (the pick of the
   * dev core).
   */
  | { readonly type: "pick"; readonly id: number; readonly x: number; readonly y: number; readonly pane: number }
  /** The selection outline: one target, a list of targets, or null for none. */
  | { readonly type: "select"; readonly target: SelectTarget | readonly SelectTarget[] | null }
  /** The import previews at their drop points; an empty list removes them. */
  | { readonly type: "previews"; readonly models: readonly PreviewModel[] }
  /** The scratch props of the checkout and, when they change, their models (scratch.ts). */
  | { readonly type: "scratch"; readonly update: ScratchUpdate }
  /** The ghosts of the proposals (ghosts.ts); an empty list removes them. */
  | { readonly type: "ghosts"; readonly specs: readonly GhostSpec[] }
  /** Answer "ghostList" with the ghosts as the core draws them. */
  | { readonly type: "listGhosts"; readonly id: number }
  /** The editor overlay (overlay.ts); an empty spec removes it. */
  | { readonly type: "overlay"; readonly spec: OverlaySpec }
  /** Answer "overlayList" with the overlay as the core draws it. */
  | { readonly type: "listOverlay"; readonly id: number }
  /** Answer "boxList" with the box of each prop in the frame of its place. */
  | { readonly type: "propBoxes"; readonly id: number }
  /** The onion skin (onion.ts); a spec with no offsets removes it. */
  | { readonly type: "onion"; readonly spec: OnionSpec }
  /** Answer "onionList" with the onion skin as the core draws it. */
  | { readonly type: "listOnion"; readonly id: number }
  /** The solo and hide of the panes (hiding.ts); an empty spec shows every item. */
  | { readonly type: "paneHide"; readonly spec: HideSpec }
  /** Answer "hideList" with the solo and hide as the core holds it. */
  | { readonly type: "listHide"; readonly id: number }
  /** Draw a frame and answer "captureChecked": a capture against a readback. */
  | { readonly type: "captureCheck"; readonly id: number }
  /**
   * Update the scene at each sample without a render, and answer "swept" with the inspect report of each sample
   * (the sweep of the dev core).
   */
  | { readonly type: "sweep"; readonly id: number; readonly samples: readonly SweepSample[] }
  /**
   * Draw the pictures of the frame index at the samples without a seek, and answer "shot" (the shots of the dev core).
   */
  | {
      readonly type: "shots";
      readonly id: number;
      readonly samples: ShotRequest["samples"];
      readonly width: number;
      readonly height: number;
      readonly view: ShotRequest["view"];
    };

/** The answers of the dev worker. `Report` is the inspect report of the plugin core. */
export type DevFromWorker<Report extends InspectReport = InspectReport> =
  /** The frame after a "mark" is drawn, at this simulation time. */
  | { readonly type: "drawn"; readonly id: number; readonly simMs: number | null }
  | { readonly type: "inspected"; readonly id: number; readonly report: Report }
  | { readonly type: "captured"; readonly id: number; readonly capture: FrameCapture }
  /** The reports of a "sweep", one per sample in the order of the samples. */
  | { readonly type: "swept"; readonly id: number; readonly reports: readonly Report[] }
  /** The pictures of a "shots", one per sample in the order of the samples (none when the core cannot draw them). */
  | { readonly type: "shot"; readonly id: number; readonly shots: readonly IndexShot<Report>[] }
  /** The answer of a "pick": null when the ray hits nothing. */
  | { readonly type: "picked"; readonly id: number; readonly result: PickResult | null }
  /** The answer of a "captureCheck": null where the worker cannot copy the canvas. */
  | { readonly type: "captureChecked"; readonly id: number; readonly check: CaptureCheck | null }
  /** The answer of a "listGhosts". */
  | { readonly type: "ghostList"; readonly id: number; readonly ghosts: readonly GhostView[] }
  /** The answer of a "listOverlay": null before the first use of the overlay. */
  | { readonly type: "overlayList"; readonly id: number; readonly overlay: OverlayView | null }
  /** The answer of a "propBoxes". */
  | { readonly type: "boxList"; readonly id: number; readonly boxes: Readonly<Record<string, PropBox>> }
  /** The answer of a "listOnion": null before the first use of the onion skin. */
  | { readonly type: "onionList"; readonly id: number; readonly onion: OnionView | null }
  /** The answer of a "listHide". */
  | { readonly type: "hideList"; readonly id: number; readonly spec: HideSpec };
