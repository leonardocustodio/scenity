// SPDX-License-Identifier: Apache-2.0
/**
 * The layouts of the split screen of the labs: one canvas with 1 to 4 panes, each with its camera. This module is plain
 * math without three.js: the lab page and the labs core both use it, so the boxes of the page (the focus ring, a click)
 * and the boxes of the core (the viewport and the scissor) agree.
 *
 * The main pane is pane 0. In every layout it is at the top left corner of the canvas, so a point of the canvas is
 * also a point of the main pane (the pick and the drag use canvas points).
 */
import type { CameraView } from "@scenity/runtime/framing";

/** The layouts: 1 pane, 2 side by side, 2 stacked, 3 (one large and two small), 4 in a 2 × 2 grid. */
export const PANE_LAYOUTS = ["1", "2h", "2v", "3", "2x2"] as const;
export type PaneLayout = (typeof PANE_LAYOUTS)[number];

/** A box of a pane as shares of the canvas (0 to 1), from the top left corner. */
export interface PaneShare {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A box of a pane in pixels, from the top left corner. */
export interface PaneBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const THIRD = 2 / 3;

/** The boxes of each layout. The order is the order of the panes; pane 0 is the main pane. */
export const LAYOUT_SHARES: Readonly<Record<PaneLayout, readonly PaneShare[]>> = {
  "1": [{ x: 0, y: 0, width: 1, height: 1 }],
  "2h": [
    { x: 0, y: 0, width: 0.5, height: 1 },
    { x: 0.5, y: 0, width: 0.5, height: 1 },
  ],
  "2v": [
    { x: 0, y: 0, width: 1, height: 0.5 },
    { x: 0, y: 0.5, width: 1, height: 0.5 },
  ],
  "3": [
    { x: 0, y: 0, width: THIRD, height: 1 },
    { x: THIRD, y: 0, width: 1 - THIRD, height: 0.5 },
    { x: THIRD, y: 0.5, width: 1 - THIRD, height: 0.5 },
  ],
  "2x2": [
    { x: 0, y: 0, width: 0.5, height: 0.5 },
    { x: 0.5, y: 0, width: 0.5, height: 0.5 },
    { x: 0, y: 0.5, width: 0.5, height: 0.5 },
    { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
  ],
};

/** The panes of a layout. */
export function paneCount(layout: PaneLayout): number {
  return LAYOUT_SHARES[layout].length;
}

/** True for a layout name. */
export function isPaneLayout(value: unknown): value is PaneLayout {
  return typeof value === "string" && (PANE_LAYOUTS as readonly string[]).includes(value);
}

/** The layout of a URL value (`panes=`): a layout name, or `2` (side by side) and `4` (2 × 2); else null. */
export function parsePaneLayout(text: string | null): PaneLayout | null {
  if (text === "2") return "2h";
  if (text === "4") return "2x2";
  return isPaneLayout(text) ? text : null;
}

/**
 * The boxes of the panes in whole pixels for a canvas of `width` × `height` pixels. The edges between the panes are
 * rounded one time, so the boxes cover the canvas without a gap and without an overlap.
 */
export function paneBoxes(layout: PaneLayout, width: number, height: number): PaneBox[] {
  return LAYOUT_SHARES[layout].map((share) => {
    const left = Math.round(share.x * width);
    const top = Math.round(share.y * height);
    const right = Math.round((share.x + share.width) * width);
    const bottom = Math.round((share.y + share.height) * height);
    return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
  });
}

/** The pane under a point of a canvas of `width` × `height` (the same units), or -1 outside the canvas. */
export function paneAt(layout: PaneLayout, width: number, height: number, x: number, y: number): number {
  if (!(width > 0 && height > 0)) return -1;
  return LAYOUT_SHARES[layout].findIndex((share) => {
    const fx = x / width;
    const fy = y / height;
    return fx >= share.x && fx < share.x + share.width && fy >= share.y && fy < share.y + share.height;
  });
}

/**
 * The panes that the labs core draws (the worker message `views`): the layout, the camera of each pane (null: the
 * framing of the room kit, the learner view) and the panes that hide the debug layers. `views[0]` is the
 * main pane; a missing view is the framing.
 */
export interface PaneViews {
  readonly layout: PaneLayout;
  readonly views: readonly (CameraView | null)[];
  readonly hideDebug?: readonly boolean[];
  /**
   * The own tune values of each pane (a layout variant: every tuned number, as `setTunes` takes them), or null for the
   * tune values of the page. With one set or more, each pane draws its own scene at the clock time (panesCore.ts).
   * Absent: every pane shows the scene of the page.
   */
  readonly tunes?: readonly (PaneTunes | null)[];
}

/** The tune values of one pane (paths and numbers). */
export type PaneTunes = Readonly<Record<string, number>>;

/** True when a pane of the layout has its own tune values. */
export function hasPaneTunes(panes: Pick<PaneViews, "layout" | "tunes">): boolean {
  return (panes.tunes ?? []).slice(0, paneCount(panes.layout)).some((set) => set != null);
}

/** One pane over the full canvas: the frame of the runtime. */
export const SINGLE_PANE: PaneViews = { layout: "1", views: [null] };

/** What `capture` takes: one pane (default: the main pane), or the whole canvas with all its panes. */
export interface CaptureTarget {
  readonly pane?: number;
  readonly grid?: boolean;
  /**
   * True shows the onion skin in the picture, false hides it; absent: the capture mode of the page
   * (`OnionSpec.capture`, off by default).
   */
  readonly onion?: boolean;
  /**
   * True draws the picture with the solo and hide of its pane (hiding.ts); absent or false: every item shows. A grid
   * picture takes the hide of each pane.
   */
  readonly hidden?: boolean;
}

/** A plain copy of the panes for a worker message (no reactive values of a page). */
export function plainPanes(panes: PaneViews): PaneViews {
  const count = paneCount(panes.layout);
  const views = Array.from({ length: count }, (_, index) => {
    const view = panes.views[index] ?? null;
    return view === null ? null : { position: [...view.position], target: [...view.target], fov: view.fov };
  }) as CameraView[];
  const hideDebug = Array.from({ length: count }, (_, index) => panes.hideDebug?.[index] === true);
  // The own tune values of the panes only when a pane has them (the message of the other pages stays the same).
  if (!hasPaneTunes(panes)) return { layout: panes.layout, views, hideDebug };
  const tunes = Array.from({ length: count }, (_, index) => {
    const set = panes.tunes?.[index] ?? null;
    return set === null ? null : { ...set };
  });
  return { layout: panes.layout, views, hideDebug, tunes };
}
