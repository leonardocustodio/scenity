// SPDX-License-Identifier: Apache-2.0
/**
 * The names of the desktop fast path that the host and the workbench page share. `protocol.ts` exports them. The
 * module is pure (no `node:` or `bun:` import).
 *
 * The host sends these surface calls. The workbench page answers them itself (apps/workbench `desktop/localCalls.ts`),
 * never the frame. In a browser, the page answers an error that starts with the `NO_NATIVE_…` text. Then the host
 * uses the browser path (the canvas capture, MediaRecorder).
 */

/** The surface call of a native snapshot of a frame region, args `[{ width }]`. */
export const SNAPSHOT_CALL = "snapshot";
/** The start of the error of a page that cannot take a native snapshot. */
export const NO_NATIVE_SNAPSHOT = "NO_NATIVE_SNAPSHOT";
/** The surface call of an MP4 clip of the lab frame, args `[ClipMp4Request]`. */
export const CLIP_MP4_CALL = "clipMp4";
/** The start of the error of a page without the MP4 writer of the shell. */
export const NO_NATIVE_MP4 = "NO_NATIVE_MP4";
/** The route of the MP4 of a clip (`POST`, the token header). */
export const CLIP_MP4_PATH = "/clips/mp4";

/** A clip of the lab frame: the time range (ms of the take), the frame rate, the camera, the size. */
export interface ClipMp4Request {
  readonly from: number;
  readonly to: number;
  readonly fps: number;
  readonly camera: string | null;
  /** Even sides in px (H.264). */
  readonly width: number;
  readonly height: number;
  /** A take to load first, or null for the take of the frame. */
  readonly take: string | null;
}
