// SPDX-License-Identifier: Apache-2.0
/**
 * The icons of the lights and the cameras of the scene page. Each light and each document camera gets a button over
 * the canvas at its place, from the view that draws (dragMath.ts). A click selects the entity (Shift adds or removes
 * it). The icons are HTML on the main thread, so they never go into a frame of the core, a capture or a frame key.
 * The document camera that draws has no icon (it is at the eye). The titles are Fluent messages of
 * `src/i18n/en-US/viewport.ftl`.
 */
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { worldTransform } from "@scenity/scene/world";
import { projectPoint, type CameraView } from "../dragMath";
import { t } from "../../texts";
import { placePart } from "../pageParts";
import type { ViewIcon } from "./viewportTypes";

const SVG = "http://www.w3.org/2000/svg";
/** The size of an icon (CSS pixels). */
const ICON_PX = 22;

/** The lights and the cameras of each document (an edit makes a new document). */
const MARKED = new WeakMap<SceneDocument, readonly (readonly [string, ViewIcon["kind"]])[]>();

/** The visible lights and cameras of a document. Each frame of the page reads them, so a document keeps its list. */
function markedEntities(doc: SceneDocument): readonly (readonly [string, ViewIcon["kind"]])[] {
  const known = MARKED.get(doc);
  if (known !== undefined) return known;
  const marked: (readonly [string, ViewIcon["kind"]])[] = [];
  for (const [id, entity] of Object.entries(doc.entities)) {
    const kind =
      entity.components.light !== undefined ? "light" : entity.components.camera !== undefined ? "camera" : null;
    if (kind === null) continue;
    if ((entity.components.visibility as { visible?: unknown } | undefined)?.visible === false) continue;
    marked.push([id, kind]);
  }
  MARKED.set(doc, marked);
  return marked;
}

/** The icons on a canvas of `width` × `height` CSS pixels. `skip` is the entity of the eye (or null). */
export function viewIcons(
  doc: SceneDocument,
  view: CameraView,
  width: number,
  height: number,
  skip: string | null,
): ViewIcon[] {
  const icons: ViewIcon[] = [];
  for (const [id, kind] of markedEntities(doc)) {
    if (id === skip) continue;
    const world = worldTransform(doc, id);
    const point = world === undefined ? null : projectPoint(view, world.position, width, height);
    if (point === null || point.x < 0 || point.y < 0 || point.x > width || point.y > height) continue;
    icons.push({ id, kind, x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 });
  }
  return icons.sort((a, b) => a.id.localeCompare(b.id));
}

/** The picture of an icon: a bulb for a light, a body and a lens for a camera. */
function picture(kind: ViewIcon["kind"]): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const shape = (tag: string, attributes: Record<string, string>): void => {
    const node = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    svg.append(node);
  };
  if (kind === "light") {
    shape("circle", { cx: "12", cy: "10", r: "6" });
    shape("path", { d: "M9 17h6M10 20h4" });
  } else {
    shape("rect", { x: "3", y: "7", width: "13", height: "10", rx: "1.5" });
    shape("path", { d: "M16 10l5-3v10l-5-3z" });
  }
  return svg;
}

/** The layer of the icons over the canvas: `show` places the buttons of the icons. */
export class IconLayer {
  readonly root = document.createElement("div");
  readonly #buttons = new Map<string, HTMLButtonElement>();

  constructor(
    private readonly select: (id: string, add: boolean) => void,
    private readonly label: (id: string) => string,
  ) {
    this.root.id = "scene-view-icons";
    this.root.dataset.testid = "scene-view-icons";
    placePart(this.root, "view");
  }

  /** Place the layer over the canvas box and show the icons. `selected` marks the selected entities. */
  show(box: DOMRect, icons: readonly ViewIcon[], selected: readonly string[]): void {
    const px = (value: number): string => `${String(value)}px`;
    Object.assign(this.root.style, {
      left: px(box.left),
      top: px(box.top),
      width: px(box.width),
      height: px(box.height),
    });
    const shown = new Set<string>();
    for (const icon of icons) {
      shown.add(icon.id);
      const button = this.#button(icon);
      button.style.left = px(icon.x - ICON_PX / 2);
      button.style.top = px(icon.y - ICON_PX / 2);
      button.setAttribute("aria-pressed", String(selected.includes(icon.id)));
    }
    for (const [id, button] of this.#buttons) {
      if (shown.has(id)) continue;
      button.remove();
      this.#buttons.delete(id);
    }
  }

  #button(icon: ViewIcon): HTMLButtonElement {
    const found = this.#buttons.get(icon.id);
    if (found?.dataset.kind === icon.kind) return found;
    found?.remove();
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.testid = `scene-icon-${icon.id}`;
    button.dataset.kind = icon.kind;
    const name = this.label(icon.id);
    button.title = icon.kind === "light" ? t("viewport-icon-light", { name }) : t("viewport-icon-camera", { name });
    button.setAttribute("aria-label", button.title);
    button.append(picture(icon.kind));
    button.addEventListener("click", (event) => {
      this.select(icon.id, event.shiftKey);
    });
    this.root.append(button);
    this.#buttons.set(icon.id, button);
    return button;
  }
}
