// SPDX-License-Identifier: Apache-2.0
/**
 * The layout variants of the scene editor on the surface bridge. The module is
 * pure (no `node:` or `bun:` import): the page imports it through `@scenity/workbench-host/protocol`. The
 * events and their checks are in @scenity/bridge (editEvents.ts); this module keeps the arguments of the run.
 *
 * - `layout` (frame to host): "Save layout as". The host runs `labs layout-save <name> --tunes "<tune text>"` (a run of
 *   the Runs tab: the dry run with the file that it writes, then the write of
 *   `apps/editor/src/core/layouts/<name>.json`) and returns the output to the lab (`layoutResult`).
 * - `variants` (frame to host): the variants of a layout search of the lab. The host keeps them as candidates of the
 *   picker (picker.ts), so the owner can pick among them in the Picker tab. A new search replaces them.
 */
import type { LayoutEventBody } from "@scenity/bridge";

/** The longest part of a tune text in one argument (a run refuses an argument over 1000 characters). */
const TUNES_PART = 900;

/** The parts of a tune text at its commas, each at most TUNES_PART characters (`--tunes` can come more than once). */
export function tuneParts(text: string): string[] {
  const parts: string[] = [];
  let part = "";
  for (const pair of text === "" ? [] : text.split(",")) {
    if (part !== "" && part.length + 1 + pair.length > TUNES_PART) {
      parts.push(part);
      part = "";
    }
    part = part === "" ? pair : `${part},${pair}`;
  }
  return [...parts, part];
}

/** The arguments of `labs layout-save` for a `layout` event (each value as one argument). */
export function layoutSaveArgs(event: LayoutEventBody): string[] {
  return [
    event.name,
    ...tuneParts(event.tunes).map((part) => `--tunes=${part}`),
    ...(event.doc === undefined || event.doc === "" ? [] : [`--doc=${event.doc}`]),
    ...(event.camera === undefined ? [] : [`--view=${event.camera}`]),
    ...(event.replace === true ? ["--replace"] : []),
    ...(event.dry ? ["--dry"] : []),
  ];
}
