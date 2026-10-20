// SPDX-License-Identifier: Apache-2.0
/**
 * The key of the frame strip: the frame key of `@scenity/labs-platform` with the inputs of a strip. The key does not
 * use the start time of the dev server (`__LAB_SESSION__`). The content hash names the code. Thus the frames of a strip
 * stay valid after a restart of the dev server, and become invalid after an edit of a file that a frame depends on.
 */
import type { CameraView } from "@scenity/runtime/framing";
import { frameKey, type FrameView, type RendererBackend } from "@scenity/labs-platform/frameKey";

/** The inputs of one strip: the scene, the window and the slot count, the camera, the renderer options, the code. */
export interface StripKeyInput {
  readonly take: string;
  readonly events: readonly unknown[];
  readonly range: { readonly from: number; readonly to: number };
  readonly count: number;
  /** The view at the end of the last camera move, or the name of the camera. */
  readonly view: CameraView | string | null;
  readonly tunes: Readonly<Record<string, number>>;
  readonly debug: readonly string[];
  readonly assets: boolean;
  readonly tier: string;
  readonly backend?: RendererBackend;
  readonly contentHash: string;
  /** The scratch props (the text of the `scratch` URL parameter); absent or "" for none. */
  readonly scratch?: string;
}

/** A camera view as a frame view: `[x, y, z, tx, ty, tz, fov]`, a camera name, or null. */
export function frameViewOf(view: CameraView | string | null): FrameView {
  if (view === null || typeof view === "string") return view;
  return [...view.position, ...view.target, view.fov];
}

/** The key of a strip; the key of a slot is `<strip key>:<slot index>`. */
export function stripKey(input: StripKeyInput): string {
  return frameKey({
    source: `take:${input.take}`,
    // The slot times come from the window and the count: they are inputs of each frame of the strip.
    events: [input.events, { strip: input.range, count: input.count }],
    timeMs: 0,
    view: frameViewOf(input.view),
    tunes: input.tunes,
    renderer: {
      debug: input.debug,
      assets: input.assets,
      ...(input.scratch === undefined || input.scratch === "" ? {} : { scratch: input.scratch }),
    },
    tier: input.tier,
    contentHash: input.contentHash,
    ...(input.backend === undefined ? {} : { backend: input.backend }),
  });
}
