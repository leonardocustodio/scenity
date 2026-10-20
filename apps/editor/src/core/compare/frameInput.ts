// SPDX-License-Identifier: Apache-2.0
/**
 * The frame input of a plain take in the frame index. A plain take is a named take with its own events and no events
 * of the panel, a named camera, no tune values, the default renderer options (no debug layer, the glTF assets, full
 * motion) and a tier. It is the input of the lab state of that take (`labFrameInput` of index/frameInput.ts). Thus the
 * compare view finds the frames that the indexer made of the plain take. Also, the indexer finds the frames that the
 * compare view drew.
 */
import type { FrameKeyInput } from "@scenity/labs-platform/frameKey";
import { labFrameInput } from "../index/frameInput";
import { takeNamed } from "../sequence";

/** The tier of the frames of the compare view: the default of the lab tools (`labs shot`). */
export const COMPARE_TIER = "high";
/** The width of the frames of the compare view: the large size of the index. */
export const COMPARE_WIDTH = 640;
export const COMPARE_HEIGHT = 400;

/** The frame input of a plain take at a time from a named camera (null: the framing of the room kit). */
export function plainTakeInput(
  take: string,
  timeMs: number,
  camera: string | null,
  contentHash: string,
  tier: string = COMPARE_TIER,
): FrameKeyInput {
  const state = {
    take,
    track: null,
    events: takeNamed(take)?.events ?? [],
    tunes: {},
    debug: [],
    assets: true,
    reduced: false,
    tier,
  };
  return labFrameInput(state, timeMs, camera ?? "overview", contentHash);
}
