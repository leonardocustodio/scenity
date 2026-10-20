// SPDX-License-Identifier: Apache-2.0
/**
 * The split screen in the script API of the lab page:
 *
 *     lab.panes("2x2", ["overview", "chest", "head", "top"]); // a layout and the cameras, the main pane first
 *     lab.panes(); // the state: the layout, the cameras, the focused pane, the full-size pane
 *     lab.focusPane(2);
 *     await lab.capture({ pane: 1, width: 640 }); // one pane, as WebP bytes (or JPEG in WebKit)
 *     await lab.capture({ grid: true }); // the full canvas with all its panes, from the same frame
 *     await lab.capture({ onion: true }); // with the onion skin of the members
 *     await lab.capture({ hidden: true }); // with the solo and hide of the pane
 *     lab.dropPane(2); // remove pane 2 from the layout (a detach); the result is its camera text
 *     lab.addPane("chest"); // add a camera as the last pane again (a dock back)
 */
import { DEFAULT_CAPTURE_WIDTH, type BridgeCapture } from "@scenity/bridge";
import { isPaneLayout, type PaneLayout } from "@scenity/runtime-dev";
import { onBeforeUnmount, type ShallowRef } from "vue";
import { captureFrame } from "../bridge/workbenchCapture";
import { cameraNames, isCameraName } from "../cameras";
import type { ViewHandle } from "../useLabStats";
import { camsText, defaultCams, parseCams } from "./paneUrl";
import type { LabPanes } from "./usePanes";

/** The state of the split screen in the script API. */
export interface PaneState {
  readonly layout: PaneLayout;
  /** The camera of each pane, the main pane first: a camera name, or `view:x,y,z,tx,ty,tz,fov`. */
  readonly cams: readonly string[];
  readonly focus: number;
  readonly full: number | null;
}

/** The options of `capture`: one pane (default: the main pane) or the grid, the size and the quality. */
export interface PaneCaptureOptions {
  readonly pane?: number;
  readonly grid?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly quality?: number;
  /** True shows the onion skin in the picture, false hides it (default: the mode). */
  readonly onion?: boolean;
  /** True draws the picture with the solo and hide of the pane (default: every item shows). */
  readonly hidden?: boolean;
}

export interface LabPaneApi {
  panes(layout?: string | null, cams?: readonly string[]): PaneState;
  /** Remove a pane (1 to 3) from the layout. The result is its camera text, or null for no such pane. */
  dropPane(pane: number): string | null;
  /** Add a camera (a name or `view:x,y,z,tx,ty,tz,fov`) as the last pane; at most 4 panes. */
  addPane(cam: string): PaneState;
  focusPane(pane: number): void;
  capture(options?: PaneCaptureOptions): Promise<BridgeCapture>;
}

/** The layout of a count of panes (one pane less after a detach, one more after a dock back). */
export function layoutOf(count: number): PaneLayout {
  const layouts: readonly PaneLayout[] = ["1", "2h", "3", "2x2"];
  return layouts[Math.min(4, Math.max(1, count)) - 1] ?? "1";
}

/** Remove a pane (1 to 3) from the layout. The result is its camera text, or null for no such pane. */
export function dropPane(panes: LabPanes, pane: number): string | null {
  const cams = panes.cams.value;
  const cam = Number.isInteger(pane) && pane >= 1 ? cams[pane] : undefined;
  if (cam === undefined) return null;
  const text = camsText([cam]);
  const rest = cams.slice(1).filter((_, index) => index !== pane - 1);
  // The panes after the gap move up; the free places keep the default cameras.
  panes.others.value = defaultCams().map((item, index) => rest[index] ?? item);
  panes.focusPane(0);
  panes.setLayout(layoutOf(cams.length - 1));
  return text;
}

/** Add a camera (a name or `view:x,y,z,tx,ty,tz,fov`) as the last pane; at most 4 panes. */
export function addPane(panes: LabPanes, cam: string): void {
  const [parsed] = parseCams(cam);
  if (parsed == null) {
    throw new Error(`No camera "${cam}". Cameras: ${cameraNames().join(", ")}, or view:x,y,z,tx,ty,tz,fov.`);
  }
  const count = panes.cams.value.length;
  if (count >= 4) throw new Error("The split screen has 4 panes already.");
  const others = [...panes.others.value];
  others[count - 1] = parsed;
  panes.others.value = others;
  panes.setLayout(layoutOf(count + 1));
}

/** The script API of the split screen on a page. */
export function paneApi(panes: LabPanes, view: ShallowRef<ViewHandle | null>): LabPaneApi {
  const state = (): PaneState => ({
    layout: panes.layout.value,
    cams: camsText(panes.cams.value).split(/,(?!-?\d)/),
    focus: panes.focus.value,
    full: panes.full.value,
  });
  return {
    panes: (layout, cams) => {
      if (layout !== undefined && layout !== null) {
        if (!isPaneLayout(layout)) throw new Error(`No layout "${layout}". Layouts: 1, 2h, 2v, 3, 2x2.`);
        panes.setLayout(layout);
      }
      (cams ?? []).forEach((name, pane) => {
        if (!isCameraName(name)) throw new Error(`No camera "${name}". Cameras: ${cameraNames().join(", ")}.`);
        panes.setCamera(pane, name);
      });
      return state();
    },
    focusPane: (pane) => {
      panes.focusPane(pane);
    },
    dropPane: (pane) => dropPane(panes, pane),
    addPane: (cam) => {
      addPane(panes, cam);
      return state();
    },
    capture: (options = {}) => {
      const where = options.grid === true ? { grid: true } : { pane: options.pane ?? 0 };
      // const target = options.onion === undefined ? where : { ...where, onion: options.onion };
      const onion = options.onion === undefined ? {} : { onion: options.onion };
      const target = { ...where, ...onion, ...(options.hidden === true ? { hidden: true } : {}) };
      return captureFrame(view.value, options.width ?? DEFAULT_CAPTURE_WIDTH, options.quality, options.height, target);
    },
  };
}

/** Add the split screen methods to the script API of the page, and remove them when the page unmounts. */
export function installPaneApi(api: LabPaneApi): void {
  const lab = globalThis.__room3dLab;
  if (lab !== undefined) Object.assign(lab, api);
  onBeforeUnmount(() => {
    const current = globalThis.__room3dLab as Record<string, unknown> | undefined;
    if (current !== undefined) for (const key of Object.keys(api)) Reflect.deleteProperty(current, key);
  });
}
