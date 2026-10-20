// SPDX-License-Identifier: Apache-2.0
/**
 * The bar of a pane of the split view. It has the camera of the pane (a view along an axis, the free perspective view
 * or a document camera) and its view mode. It also has "Main", which puts the pane into the main view. The pane
 * element holds the bar and gets the drag and the wheel of the pane (splitViews.ts). The bar has only DOM nodes, as
 * the icons of the view.
 */
import { PANE_MODES, type PaneMode } from "@scenity/runtime-dev/document/splitView";
import { t } from "../../texts";
import { EDITOR_VIEWS } from "./editorViews";
import type { PaneCamera, PaneState } from "./splitViews";

/** What the bar of a pane calls. */
export interface PaneBarParts {
  cameras(): readonly { readonly id: string; readonly label: string }[];
  setCamera(index: number, camera: PaneCamera): void;
  setMode(index: number, mode: PaneMode | null): void;
  swap(index: number): void;
}

/** The mode of the lit view in the mode menu. */
const LIT = "lit";

function select(
  label: string,
  testid: string,
  options: readonly (readonly [string, string])[],
  value: string,
): HTMLSelectElement {
  const node = document.createElement("select");
  node.setAttribute("aria-label", label);
  node.dataset.testid = testid;
  for (const [optionValue, text] of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = text;
    node.append(option);
  }
  node.value = value;
  return node;
}

/** The element of pane `index` (1 is the first pane after the main view) with its bar. */
export function paneBar(index: number, pane: PaneState, parts: PaneBarParts): HTMLElement {
  const element = document.createElement("div");
  element.className = "scene-pane";
  element.dataset.testid = "scene-pane";
  element.dataset.pane = String(index);
  element.dataset.camera = pane.camera;
  const bar = document.createElement("div");
  bar.className = "scene-pane-bar";
  const cameras: [string, string][] = [
    ...EDITOR_VIEWS.map((name): [string, string] => [name, t(`viewport-command-view-${name}`)]),
    ["perspective", t("viewport-pane-perspective")],
    ...parts.cameras().map((item): [string, string] => [`camera:${item.id}`, item.label]),
  ];
  const camera = select(t("viewport-pane-camera", { pane: index + 1 }), "scene-pane-camera", cameras, pane.camera);
  camera.addEventListener("change", () => parts.setCamera(index, camera.value as PaneCamera));
  const modes: [string, string][] = [
    [LIT, t("viewport-mode-lit")],
    ...PANE_MODES.map((mode): [string, string] => [
      mode,
      t(mode === "normalShading" ? "viewport-mode-normals" : `viewport-mode-${mode}`),
    ]),
  ];
  const mode = select(t("viewport-pane-mode", { pane: index + 1 }), "scene-pane-mode", modes, pane.mode ?? LIT);
  mode.addEventListener("change", () => parts.setMode(index, mode.value === LIT ? null : (mode.value as PaneMode)));
  const main = document.createElement("button");
  main.type = "button";
  main.textContent = t("viewport-pane-main");
  main.title = t("viewport-pane-main-title");
  main.dataset.testid = "scene-pane-main";
  main.addEventListener("click", () => parts.swap(index));
  bar.append(camera, mode, main);
  element.append(bar);
  return element;
}
