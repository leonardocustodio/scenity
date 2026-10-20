// SPDX-License-Identifier: Apache-2.0
/**
 * The places of the plain DOM parts of the page. In the edit mode, the studio shell gives a region for each place. The
 * file bar goes into `bar`, the gizmo bar into `tools`, and the play control into `clock` (the centre of the toolbar).
 * The parts over the canvas go into `view` (the Scene view panel), and the status parts go into `status`. With no shell
 * (the page with no edit mode, a test), a part goes on the body.
 */
import { nextTick } from "vue";
import type { PanelContent } from "../studio/shell/panels";
import { currentShell } from "../studio/shell/shell";

/** The places of the parts. */
export type PartPlace = "bar" | "tools" | "clock" | "view" | "status";

let places: Partial<Readonly<Record<PartPlace, HTMLElement>>> = {};

/** The regions of the shell for the parts that come next (`{}` removes them). */
export function setPartPlaces(next: Partial<Readonly<Record<PartPlace, HTMLElement>>>): void {
  places = next;
}

/** The element of a place: the region of the shell, else the body. */
export function partPlace(place: PartPlace): HTMLElement {
  return places[place] ?? document.body;
}

/** Put a part of the page in its place. */
export function placePart(element: HTMLElement, place: PartPlace): void {
  partPlace(place).append(element);
}

/**
 * Give a panel of the editor window its content (the one Vue app of the shell, no app of its own). The result
 * resolves when the content has rendered.
 */
export async function setPanelContent(id: string, content: PanelContent): Promise<void> {
  const shell = currentShell();
  if (shell === null) throw new Error(`The page has no editor window for the panel ${id}.`);
  shell.setPanel(id, content);
  await nextTick();
}
