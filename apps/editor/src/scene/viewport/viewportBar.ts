// SPDX-License-Identifier: Apache-2.0
/**
 * The viewport bar of the scene page: the camera menu (the editor camera and the document cameras), the view mode
 * (lit, unlit, wireframe, normals), the grid switch and the Frame button (F). The texts are Fluent messages of
 * `src/i18n/en-US/viewport.ftl`. The bar has no design tokens, and the page styles it in viewport.css. In the editor
 * window, the controls go into the overlays of the Scene view.
 */
import { t } from "../../texts";
import { placePart } from "../pageParts";
import { debugLayersPart } from "./debugLayersPart";
import type { OverlayDock } from "./overlays";
import type { ViewMode } from "./viewportTypes";

/** The state that the bar shows. */
export interface BarState {
  /** "editor" or the ID of the document camera that draws. */
  readonly camera: string;
  /** The document cameras: their IDs and labels, in the order of the number keys. */
  readonly cameras: readonly { readonly id: string; readonly label: string }[];
  readonly viewMode: ViewMode;
  readonly grid: boolean;
}

/** What the bar asks of the viewport. */
export interface BarActions {
  camera(id: string): void;
  viewMode(mode: ViewMode): void;
  grid(on: boolean): void;
  frame(): void;
}

const MODES: readonly { mode: ViewMode; label: () => string }[] = [
  { mode: "lit", label: () => t("viewport-mode-lit") },
  { mode: "unlit", label: () => t("viewport-mode-unlit") },
  { mode: "wireframe", label: () => t("viewport-mode-wireframe") },
  { mode: "normals", label: () => t("viewport-mode-normals") },
];

function labelled(text: string, control: HTMLElement): HTMLLabelElement {
  const label = document.createElement("label");
  label.append(text, " ", control);
  return label;
}

function select(testId: string, title: string, change: (value: string) => void): HTMLSelectElement {
  const element = document.createElement("select");
  element.dataset.testid = testId;
  element.title = title;
  element.addEventListener("change", () => {
    change(element.value);
    // The keys of the camera go to the page again, not to the menu.
    element.blur();
  });
  return element;
}

/** A group of controls of an overlay. */
function group(...controls: HTMLElement[]): HTMLElement {
  const element = document.createElement("div");
  element.className = "scene-overlay-row";
  element.append(...controls);
  return element;
}

/**
 * Make the bar and add it to the page. `show` puts a state into its controls. With the overlays of the Scene view,
 * the controls go into the overlays View options, Grid and snap, and Cameras.
 */
export function viewportBar(
  actions: BarActions,
  dock: OverlayDock | null = null,
): { readonly element: HTMLElement; show(state: BarState): void } {
  const element = document.createElement("div");
  element.id = "scene-viewport-bar";
  element.dataset.testid = "scene-viewport-bar";
  element.setAttribute("role", "toolbar");
  element.setAttribute("aria-label", t("viewport-bar"));
  const cameras = select("scene-camera-menu", t("viewport-camera-title"), (id) => {
    actions.camera(id);
  });
  const modes = select("scene-view-mode", t("viewport-view-title"), (mode) => {
    actions.viewMode(mode as ViewMode);
  });
  modes.append(...MODES.map(({ mode, label }) => new Option(label(), mode)));
  const grid = document.createElement("input");
  grid.type = "checkbox";
  grid.dataset.testid = "scene-grid";
  grid.addEventListener("change", () => {
    actions.grid(grid.checked);
  });
  const frame = document.createElement("button");
  frame.type = "button";
  frame.textContent = t("viewport-frame");
  frame.title = t("viewport-frame-title");
  frame.dataset.testid = "scene-frame";
  frame.addEventListener("click", () => {
    actions.frame();
  });
  const cameraPart = labelled(t("viewport-camera"), cameras);
  const viewPart = group(labelled(t("viewport-view"), modes), frame);
  const gridPart = group(labelled(t("viewport-grid"), grid));
  if (dock === null) {
    element.append(cameraPart, ...viewPart.children, ...gridPart.children);
    placePart(element, "view");
  } else {
    // The controls go into the overlays of the Scene view. View options also has the debug layers.
    const viewContent = document.createElement("div");
    viewContent.append(viewPart, debugLayersPart());
    dock.add({ id: "view", title: () => t("overlay-view"), edge: "top", order: 0, content: viewContent });
    dock.add({ id: "grid", title: () => t("overlay-grid"), edge: "top", order: 1, content: gridPart });
    dock.add({ id: "cameras", title: () => t("overlay-cameras"), edge: "top", order: 2, content: cameraPart });
  }
  let shown = "";
  return {
    element,
    show(state) {
      const key = JSON.stringify(state);
      if (key === shown) return;
      shown = key;
      const options = [new Option(t("viewport-camera-editor"), "editor")];
      state.cameras.forEach((camera, index) => {
        if (index < 9) {
          options.push(new Option(t("viewport-camera-option", { label: camera.label, number: index + 1 }), camera.id));
          return;
        }
        // The camera name alone is a data value of the document.
        const option = new Option(camera.label, camera.id);
        option.translate = false;
        options.push(option);
      });
      cameras.replaceChildren(...options);
      cameras.value = state.camera;
      modes.value = state.viewMode;
      grid.checked = state.grid;
    },
  };
}
