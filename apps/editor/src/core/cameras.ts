// SPDX-License-Identifier: Apache-2.0
/**
 * The named cameras of the editor. The plugin gives the views by name (`EditorPlugin.cameras`). This module gives the
 * names, the check of a name and the text of a view. A named camera with a null view is the framing of the scene
 * (`overview`). The URL parameter `camera`, the select of the View tab and the keys 1 to 9 choose a named camera. The
 * URL parameter `view` gives all other positions.
 *
 * This module has no Vue import, because the shot tools and the tests read it.
 */
import { editorPlugin } from "./plugin";

export interface NamedView {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  /** The vertical field of view (degrees). */
  readonly fov: number;
}

/** The name of a camera of the plugin. */
export type CameraName = string;

/** The name of the framing of the scene: the named camera without a view. */
export const FRAMING_CAMERA = "overview";

/** The views of the named cameras of the plugin, in their order (null: the framing of the scene). */
export function cameraViews(): Readonly<Record<CameraName, NamedView | null>> {
  return editorPlugin().cameras.views;
}

/** The names of the cameras, in their order. */
export function cameraNames(): CameraName[] {
  return Object.keys(cameraViews());
}

/** True for the name of a camera of the plugin (a simple test, because a camera name can be any text). */
export function isCameraName(value: string | null): boolean {
  return value !== null && Object.hasOwn(cameraViews(), value);
}

/** The view of a named camera (null: the framing of the scene, or an unknown name). */
export function cameraView(name: CameraName): NamedView | null {
  return cameraViews()[name] ?? null;
}

/** A view as the text of the `view` URL parameter: x,y,z,tx,ty,tz,fov. */
export function viewText(view: NamedView): string {
  return [...view.position, ...view.target, view.fov].map((value) => value.toFixed(2)).join(",");
}

/** The view of the text of the `view` URL parameter, or null when the text is not seven numbers. */
export function parseView(text: string | null): NamedView | null {
  const values = (text ?? "").split(",").map(Number);
  if (values.length !== 7 || !values.every(Number.isFinite)) return null;
  const [x, y, z, tx, ty, tz, fov] = values as [number, number, number, number, number, number, number];
  return { position: [x, y, z], target: [tx, ty, tz], fov };
}
