// SPDX-License-Identifier: Apache-2.0
/**
 * The pins of the notes in the Scene view: a pin at the place of each note that the filter shows, over the main view.
 * A pin shows the text of its note on hover. A press selects the entity of the note (the
 * note entity, or the target of a file note) or shows the Notes panel for a note at a point. DOM nodes only, as the
 * icons of the view.
 */
import { projectPoint, type CameraView } from "../dragMath";
import { placePart } from "../pageParts";
import { t } from "../../texts";
import { shownBy, type NoteFilter, type NoteItem } from "./pageNotes";

const PIN_PX = 18;

export class NotePins {
  readonly root = document.createElement("div");
  readonly #buttons = new Map<string, HTMLButtonElement>();
  readonly #press: (item: NoteItem) => void;

  constructor(press: (item: NoteItem) => void) {
    this.#press = press;
    this.root.id = "scene-note-pins";
    this.root.dataset.testid = "scene-note-pins";
    placePart(this.root, "view");
  }

  /** Place the layer over the main view and show the pins of the notes that the filter shows. */
  show(box: DOMRect, view: CameraView | null, items: readonly NoteItem[], filter: NoteFilter): void {
    const px = (value: number): string => `${String(value)}px`;
    Object.assign(this.root.style, {
      left: px(box.left),
      top: px(box.top),
      width: px(box.width),
      height: px(box.height),
    });
    const shown = new Set<string>();
    for (const item of items) {
      if (!shownBy(filter, item) || item.at === null || view === null) continue;
      const point = projectPoint(view, [...item.at], box.width, box.height);
      if (point === null) continue;
      shown.add(item.key);
      const button = this.#button(item);
      button.style.left = px(point.x - PIN_PX / 2);
      button.style.top = px(point.y - PIN_PX);
      button.dataset.status = item.status;
      button.title = item.text;
      button.setAttribute("aria-label", t("notes-pin", { text: item.text }));
    }
    for (const [key, button] of this.#buttons) {
      if (shown.has(key)) continue;
      button.remove();
      this.#buttons.delete(key);
    }
  }

  #button(item: NoteItem): HTMLButtonElement {
    const found = this.#buttons.get(item.key);
    if (found !== undefined) {
      found.onclick = () => this.#press(item);
      return found;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "✎";
    button.dataset.testid = "scene-note-pin";
    button.dataset.note = item.key;
    button.onclick = () => this.#press(item);
    this.root.append(button);
    this.#buttons.set(item.key, button);
    return button;
  }
}
