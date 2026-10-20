// SPDX-License-Identifier: Apache-2.0
/**
 * The split screen in the URL and in the browser storage.
 *
 * - The URL: `panes=2x2&cams=overview,chest,head,top`. A layout is `1`, `2h` (side by side, also `2`), `2v`
 *   (stacked), `3` (one large and two small) or `2x2` (also `4`). `cams` has the camera of each pane, the main pane
 *   first: a named camera of the plugin (cameras.ts) or a free view `view:x,y,z,tx,ty,tz,fov`.
 * - The saved layout of a checkout: in the workbench, the host keeps the URL of the lab frame for each checkout. Thus
 *   the URL is the saved state. The lab page alone keeps the last layout in the browser storage under a key of its
 *   checkout. A new checkout opens at 1 pane. A read or a write of the storage can fail (a private window). Then the
 *   page opens at 1 pane.
 *
 * This module has no imports from Vue: the tools and the tests read it.
 */
import { parsePaneLayout, type PaneLayout } from "@scenity/runtime-dev";
import {
  cameraView,
  FRAMING_CAMERA,
  isCameraName,
  parseView,
  viewText,
  type CameraName,
  type NamedView,
} from "../cameras";
import { editorPlugin } from "../plugin";

/** The camera of a pane: a named camera (its view comes from the plugin) or a free view (name null). */
export interface PaneCam {
  readonly name: CameraName | null;
  readonly view: NamedView | null;
}

/** The cameras of the panes 1 to 3 of a new page, from the plugin (the main pane keeps the camera of the page). */
export function defaultCams(): PaneCam[] {
  return editorPlugin().cameras.paneDefaults.map((name) => ({ name, view: cameraView(name) }));
}

/** The camera of a URL entry, or null for an entry that is not a camera. */
function camOf(entry: string): PaneCam | null {
  if (isCameraName(entry)) return { name: entry, view: cameraView(entry) };
  if (!entry.startsWith("view:")) return null;
  const view = parseView(entry.slice("view:".length));
  return view === null ? null : { name: null, view };
}

/** The cameras of the `cams` URL value, in the order of the panes; an entry that is not a camera gives null. */
export function parseCams(text: string | null): (PaneCam | null)[] {
  if (text === null || text === "") return [];
  const parts = text.split(",");
  const cams: (PaneCam | null)[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? "";
    // A free view has six more numbers after its first one.
    const entry = part.startsWith("view:") ? parts.slice(index, index + 7).join(",") : part;
    if (part.startsWith("view:")) index += 6;
    cams.push(camOf(entry));
  }
  return cams;
}

/** The `cams` URL value of the cameras of the panes. */
export function camsText(cams: readonly PaneCam[]): string {
  return cams.map((cam) => cam.name ?? (cam.view === null ? FRAMING_CAMERA : `view:${viewText(cam.view)}`)).join(",");
}

/** The split screen that a page keeps: the layout and the camera of each pane, the main pane first. */
export interface SavedPanes {
  readonly layout: PaneLayout;
  readonly cams: string;
}

/** The storage key of the split screen of a checkout. */
export function storageKey(checkout: string): string {
  return `room3d-lab.panes.${checkout}`;
}

/** The storage of the page, or null where the browser refuses it. */
function storage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** The saved split screen of a checkout, or null (none, or no storage). */
export function readSaved(checkout: string, store: Storage | null = storage()): SavedPanes | null {
  try {
    const raw = store?.getItem(storageKey(checkout)) ?? null;
    if (raw === null) return null;
    const value = JSON.parse(raw) as { layout?: unknown; cams?: unknown };
    const layout = parsePaneLayout(typeof value.layout === "string" ? value.layout : null);
    return layout === null ? null : { layout, cams: typeof value.cams === "string" ? value.cams : "" };
  } catch {
    return null;
  }
}

/** Keep the split screen of a checkout; 1 pane removes the saved value. A failed write changes nothing. */
export function writeSaved(checkout: string, saved: SavedPanes, store: Storage | null = storage()): void {
  try {
    if (saved.layout === "1") store?.removeItem(storageKey(checkout));
    else store?.setItem(storageKey(checkout), JSON.stringify(saved));
  } catch {
    // A private window or a full storage: the URL still has the layout.
  }
}

/** The key of this checkout (a hash of its folder, from the Vite config), or "default" outside a lab build. */
export function checkoutKey(): string {
  return typeof __LABS_CHECKOUT__ === "string" ? __LABS_CHECKOUT__ : "default";
}
