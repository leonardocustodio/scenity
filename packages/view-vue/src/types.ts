// SPDX-License-Identifier: Apache-2.0
/**
 * The types of SceneView: the options that the view gives to the renderer factory, the poster image
 * and the handle of the view for a host component.
 */
import type { SceneClient, SceneClientOptions } from "@scenity/runtime/client";
import type { ManifestRef, SceneStats, Tier } from "@scenity/runtime/protocol";

/**
 * The options that SceneView gives to the renderer factory: the options of the scene client of the runtime without
 * the fields of an extension (`link`, `init`, `getClockEpoch`). A factory of a plugin accepts more fields; it gets them
 * from its own host component (the labs renderer of the editor).
 */
export type SceneViewOptions = Omit<SceneClientOptions<never>, "link" | "init" | "getClockEpoch">;

/**
 * The factory of the renderer: the runtime client of a plugin, or a labs renderer. The view calls it once per canvas.
 * An explicit function type: the compiler then gives the prop the runtime type Function, so Vue does not call it as a
 * factory of a default value.
 */
export type SceneRendererFactory<Input> = (
  canvas: HTMLCanvasElement,
  options: SceneViewOptions,
) => Promise<SceneClient<Input>>;

/** The built assets of a quality tier for the renderer (the manifest and the file URLs), from the host. */
export type SceneAssets = (tier: Tier) => ManifestRef;

/** The poster image of the scene at the default camera. The view shows it until the first frame. */
export interface PosterImage {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

/** The current quality level of the adaptive quality, and the still pose that it chose. */
export interface SceneQuality {
  readonly tier: Tier;
  readonly scale: number;
  readonly still: boolean;
}

/** The exposed methods of SceneView for a host component. */
export interface SceneViewHandle<Input = unknown> {
  /** The frame statistics of the renderer for the frame-budget measurement, or null before its start. */
  stats(reset?: boolean): Promise<SceneStats> | null;
  quality(): SceneQuality;
  /** The renderer that draws the frames, or null before its start. A host calls its methods. */
  renderer(): SceneClient<Input> | null;
  /** The root element of the view, or null before the mount. */
  element(): HTMLElement | null;
}
