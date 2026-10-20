// SPDX-License-Identifier: Apache-2.0
/**
 * The split view of the Scene view: 1, 2 or 4 views of the scene on one canvas. The main view at the top left is the
 * view of the page. It has the editor camera, the view mode of the bar, the picks, the gizmos and the drags. Each
 * other pane has its own camera and view mode (the bar of the pane):
 *
 * - The camera of a pane is a view along a world axis (an orthographic view), a free perspective view, or a document
 *   camera. A drag in the pane turns the perspective view and pans an axis view. Shift or the middle button pans. The
 *   wheel moves the camera nearer or farther.
 * - "Main" puts the camera and the view mode of a pane into the main view, and the main view into the pane.
 * - The commands `view.split.one`, `view.split.side`, `view.split.stacked` and `view.split.four` (Window ▸ Split
 *   view) choose the layout. The storage of the browser keeps the layout and the panes (a convenience of one person).
 *
 * The dev document core draws the panes (runtime-dev splitView.ts). This module sends their views and shows their
 * bars. The pane bars are DOM nodes over the canvas, as the icons of the view.
 */
import { dolly, orbit, pan, viewOf, type OrbitCamera } from "@scenity/editor-core";
import type { EditorView } from "@scenity/runtime/protocol";
import { PANE_MODES, type PaneMode, type ScenePane, type SplitLayout } from "@scenity/runtime-dev/document/splitView";
import { paneBoxes, paneCount } from "@scenity/runtime-dev/panes";
import { t } from "../../texts";
import { placePart } from "../pageParts";
import type { PageKeyCommandSpec } from "../settings/pageKeys";
import { pageSettings } from "../settings/pageSettings";
import { EDITOR_VIEWS, telephoto, turnedTo, type EditorViewName } from "./editorViews";
import { setMainLayout } from "./mainView";
import { paneBar, type PaneBarParts } from "./splitBar";
import type { ViewportCamera } from "./viewportCamera";
import type { ViewMode, ViewportPort } from "./viewportTypes";

/** The camera of a pane: a view along an axis, the free perspective view, or `camera:<id>` (a document camera). */
export type PaneCamera = EditorViewName | "perspective" | `camera:${string}`;

/** The state of a pane after the main one. */
export interface PaneState {
  camera: PaneCamera;
  mode: PaneMode | null;
  /** The orbit of the editor camera of the pane, or null before its first view. */
  orbit: OrbitCamera | null;
}

/** The storage key of the split view. */
export const SPLIT_KEY = "scenity.scene.split";
/** The cameras of the panes at the start: the top, front and right views. */
const START_CAMERAS: readonly PaneCamera[] = ["top", "front", "right"];
/** A drag across the width of the pane turns the perspective view by a quarter turn (as in the main view). */
const TURN_ACROSS = Math.PI / 2;
const TURN_DOWN = Math.PI / 4;
const WHEEL_SCALE = 0.0015;

/** The view mode of the bar for a pane mode, and the opposite conversion. */
const MODE_OF_PANE: Readonly<Record<PaneMode, ViewMode>> = {
  unlit: "unlit",
  normalShading: "normals",
  wireframe: "wireframe",
};
export function paneModeOf(mode: ViewMode): PaneMode | null {
  return PANE_MODES.find((item) => MODE_OF_PANE[item] === mode) ?? null;
}
export function viewModeOf(mode: PaneMode | null): ViewMode {
  return mode === null ? "lit" : MODE_OF_PANE[mode];
}

/** True for a camera of a pane along a world axis. */
function isAxis(camera: PaneCamera): camera is EditorViewName {
  return (EDITOR_VIEWS as readonly string[]).includes(camera);
}

/** The view that a pane sends to the core: the editor view, or the document camera of the pane. */
export function paneView(pane: PaneState): ScenePane {
  if (pane.camera.startsWith("camera:")) return { view: null, camera: pane.camera.slice(7), mode: pane.mode };
  if (pane.orbit === null) return { view: null, camera: null, mode: pane.mode };
  const view = viewOf(pane.orbit);
  const sent: EditorView = pane.camera === "perspective" ? view : telephoto(view);
  return { view: sent, camera: null, mode: pane.mode };
}

/** What the split view reads of the viewport. */
export interface SplitParts {
  readonly canvas: HTMLCanvasElement;
  readonly camera: ViewportCamera;
  readonly port: Pick<ViewportPort, "setPanes">;
  /** The document cameras of the page with their labels. */
  cameras(): readonly { readonly id: string; readonly label: string }[];
  /** The view mode of the main view, and its change. */
  mainMode(): ViewMode;
  setMainMode(mode: ViewMode): void;
  readonly storage?: () => Storage;
}

/** The layout and the panes in the storage. */
interface Stored {
  readonly layout: SplitLayout;
  readonly panes: readonly { readonly camera: PaneCamera; readonly mode: PaneMode | null }[];
}

export class SplitViews {
  layout: SplitLayout = "1";
  readonly panes: PaneState[] = START_CAMERAS.map((camera) => ({ camera, mode: null, orbit: null }));
  readonly root = document.createElement("div");
  readonly #parts: SplitParts;
  readonly #bars: HTMLElement[] = [];
  #moving = false;
  #frame: number | null = null;

  constructor(parts: SplitParts) {
    this.#parts = parts;
    this.root.id = "scene-panes";
    this.root.dataset.testid = "scene-panes";
    placePart(this.root, "view");
    this.#load();
  }

  /** Choose a layout. The panes keep their cameras and modes. */
  setLayout(layout: SplitLayout): void {
    this.layout = layout;
    setMainLayout(layout);
    this.#draw();
    this.send();
    this.#save();
  }

  /** Change the camera or the view mode of a pane (1 is the first pane after the main view). */
  setPane(index: number, change: { readonly camera?: PaneCamera; readonly mode?: PaneMode | null }): void {
    const pane = this.panes[index - 1];
    if (pane === undefined) return;
    if (change.mode !== undefined) pane.mode = change.mode;
    if (change.camera !== undefined) {
      pane.camera = change.camera;
      const base = pane.orbit ?? this.#parts.camera.current();
      if (base !== null) pane.orbit = isAxis(change.camera) ? turnedTo(base, change.camera) : base;
    }
    this.#draw();
    this.send();
    this.#save();
  }

  /** Put the camera and the view mode of a pane into the main view, and those of the main view into the pane. */
  async swap(index: number): Promise<void> {
    const pane = this.panes[index - 1];
    const main = this.#parts.camera;
    if (pane === undefined) return;
    const before = main.current();
    const mode = this.#parts.mainMode();
    if (pane.camera.startsWith("camera:")) await main.useDocument(pane.camera.slice(7));
    else if (pane.orbit !== null) {
      main.setProjection(pane.camera === "perspective" ? "perspective" : "orthographic");
      main.move(pane.orbit, false);
    }
    this.#parts.setMainMode(viewModeOf(pane.mode));
    Object.assign(pane, { camera: "perspective", orbit: before, mode: paneModeOf(mode) });
    this.#draw();
    this.send();
    this.#save();
  }

  /** Send the panes to the core. */
  send(): void {
    const count = paneCount(this.layout) - 1;
    for (const pane of this.panes.slice(0, count)) {
      if (pane.orbit !== null || pane.camera.startsWith("camera:")) continue;
      const base = this.#parts.camera.current();
      if (base !== null) pane.orbit = isAxis(pane.camera) ? turnedTo(base, pane.camera) : base;
    }
    const others = this.panes.slice(0, count).map(paneView);
    const views = others.map((pane) =>
      pane.view === null ? pane : { ...pane, view: { ...pane.view, userCamera: this.#moving } },
    );
    this.#parts.port.setPanes({ layout: this.layout, others: views });
  }

  /** Place the bars of the panes over the canvas box (each frame of the page). */
  follow(box: DOMRect): void {
    const px = (value: number): string => `${String(value)}px`;
    Object.assign(this.root.style, {
      left: px(box.left),
      top: px(box.top),
      width: px(box.width),
      height: px(box.height),
    });
    const boxes = paneBoxes(this.layout, box.width, box.height);
    this.#bars.forEach((bar, at) => {
      const pane = boxes[at + 1];
      if (pane === undefined) return;
      Object.assign(bar.style, {
        left: px(pane.x),
        top: px(pane.y),
        width: px(pane.width),
        height: px(pane.height),
      });
    });
  }

  /** Move the editor camera of a pane with a function of it, as a move of the user. */
  change(index: number, edit: (camera: OrbitCamera) => OrbitCamera, moving: boolean): void {
    const pane = this.panes[index - 1];
    const current = pane?.orbit ?? null;
    if (pane === undefined || current === null) return;
    pane.orbit = edit(current);
    this.#moving = moving;
    if (!moving) {
      this.send();
      return;
    }
    if (this.#frame !== null) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null;
      this.send();
    });
  }

  /** The drag and the wheel of a pane. */
  listen(element: HTMLElement, index: number): void {
    let press: { pointer: number; x: number; y: number; pan: boolean } | null = null;
    element.addEventListener("pointerdown", (event) => {
      if (event.target !== element) return;
      const pane = this.panes[index - 1];
      const pan = event.shiftKey || event.button === 1 || pane?.camera !== "perspective";
      press = { pointer: event.pointerId, x: event.clientX, y: event.clientY, pan };
      element.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    element.addEventListener("pointermove", (event) => {
      if (press?.pointer !== event.pointerId) return;
      const [dx, dy] = [event.clientX - press.x, event.clientY - press.y];
      Object.assign(press, { x: event.clientX, y: event.clientY });
      const width = Math.max(1, element.clientWidth);
      const height = Math.max(1, element.clientHeight);
      const factor = pageSettings().value.camera.orbitSpeed;
      const turn = (each: OrbitCamera) =>
        orbit(each, (dx / width) * TURN_ACROSS * factor, -(dy / height) * TURN_DOWN * factor);
      this.change(index, press.pan ? (each) => pan(each, dx, dy, height) : turn, true);
    });
    const end = (event: PointerEvent): void => {
      if (press?.pointer !== event.pointerId) return;
      press = null;
      this.change(index, (each) => each, false);
    };
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
    element.addEventListener("contextmenu", (event) => event.preventDefault());
    element.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const scale = WHEEL_SCALE * pageSettings().value.camera.zoomSpeed;
        this.change(index, (each) => dolly(each, Math.exp(event.deltaY * scale)), false);
      },
      { passive: false },
    );
  }

  /** Make the bars of the panes of the layout. */
  #draw(): void {
    const count = paneCount(this.layout) - 1;
    this.root.dataset.layout = this.layout;
    const parts: PaneBarParts = {
      cameras: () => this.#parts.cameras(),
      setCamera: (index, camera) => this.setPane(index, { camera }),
      setMode: (index, mode) => this.setPane(index, { mode }),
      swap: (index) => void this.swap(index),
    };
    const bars = this.panes.slice(0, count).map((pane, at) => {
      const element = paneBar(at + 1, pane, parts);
      this.listen(element, at + 1);
      return element;
    });
    this.#bars.splice(0, this.#bars.length, ...bars);
    this.root.replaceChildren(...bars);
    this.follow(this.#parts.canvas.getBoundingClientRect());
  }

  #load(): void {
    try {
      const stored = JSON.parse(this.#storage().getItem(SPLIT_KEY) ?? "null") as Stored | null;
      if (stored === null) return;
      stored.panes.slice(0, this.panes.length).forEach((item, at) => {
        Object.assign(this.panes[at] ?? {}, { camera: item.camera, mode: item.mode });
      });
      if (["1", "2h", "2v", "2x2"].includes(stored.layout)) this.layout = stored.layout;
    } catch {
      // No storage or a bad value: one view.
    }
    setMainLayout(this.layout);
  }

  #save(): void {
    const stored: Stored = {
      layout: this.layout,
      panes: this.panes.map((pane) => ({ camera: pane.camera, mode: pane.mode })),
    };
    try {
      this.#storage().setItem(SPLIT_KEY, JSON.stringify(stored));
    } catch {
      // No storage: the split view stays for this page only.
    }
  }

  #storage(): Storage {
    return (this.#parts.storage ?? (() => localStorage))();
  }

  /** Show the stored layout after the start of the viewport. */
  start(): void {
    this.#draw();
    if (this.layout !== "1") this.send();
  }
}

/** The commands of the layouts (Window ▸ Split view). */
const SPLIT_COMMANDS: readonly (readonly [string, SplitLayout])[] = [
  ["one", "1"],
  ["side", "2h"],
  ["stacked", "2v"],
  ["four", "2x2"],
];

/** The commands that choose the layout of the split view. */
export function splitCommands(split: SplitViews): PageKeyCommandSpec[] {
  return SPLIT_COMMANDS.map(([name, layout]) => ({
    id: `view.split.${name}`,
    menu: "window/split",
    title: t(`viewport-command-split-${name}`),
    run: () => split.setLayout(layout),
  }));
}
