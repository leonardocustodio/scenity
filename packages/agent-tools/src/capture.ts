// SPDX-License-Identifier: Apache-2.0
/**
 * The picture of a frame for a tool (the same shape as the `Capture` of the workbench host protocol): the bytes of an
 * encoded picture with its size and the time of the frame. No `node:` or `bun:` import.
 */

/** The picture types of a capture: WebP; JPEG from WebKit, which has no WebP encoder; PNG as the last resort. */
export const CAPTURE_MIMES = ["image/webp", "image/jpeg", "image/png"] as const;
export type CaptureMime = (typeof CAPTURE_MIMES)[number];

/** True for a picture type of a capture. */
export function isCaptureMime(value: unknown): value is CaptureMime {
  return (CAPTURE_MIMES as readonly unknown[]).includes(value);
}

/** A picture of a frame: the bytes of the encoded picture. */
export interface Capture {
  readonly simMs: number | null;
  readonly width: number;
  readonly height: number;
  readonly mime: CaptureMime;
  readonly bytes: Uint8Array;
}
