// SPDX-License-Identifier: Apache-2.0
/**
 * The camera preview of the editor viewport: a picture of the canvas just after the dev document core drew the view of
 * a document camera, in the same task as the frame of the page. The picture is an `ImageBitmap` at the width of the
 * request and the aspect of the canvas; a worker posts it to the page.
 */
import type { RenderCanvas } from "@scenity/runtime/protocol";

/** A preview that waits for the next frame. `resolve` gets the promise of the picture. */
export interface PreviewRequest {
  readonly name: string | null;
  readonly width: number;
  /** The time of the picture (ms), or null for the time of the page. */
  readonly at: number | null;
  readonly resolve: (picture: Promise<ImageBitmap | null>) => void;
}

/**
 * The name of a preview of the current view (the editor camera or the document camera of the page) with no dev layer.
 * A person gives the picture of a region of this view to an agent.
 */
export const VIEW_PREVIEW = "@view";

/** The widest preview (pixels): a larger request gets this width. */
export const PREVIEW_MAX_WIDTH = 640;

/**
 * Take a picture of the canvas immediately, scaled to `width` pixels with the aspect of the surface. The browser copies
 * the pixels when the call starts, so a draw after the call does not change the picture. Null when the copy fails.
 */
export function capturePreview(
  canvas: RenderCanvas,
  width: number,
  surface: { readonly width: number; readonly height: number },
): Promise<ImageBitmap | null> {
  const wide = Math.max(1, Math.min(PREVIEW_MAX_WIDTH, Math.round(width)));
  const high = Math.max(1, Math.round((wide * surface.height) / Math.max(1, surface.width)));
  // A thread with no image bitmaps (a test runner) gives no picture.
  if (typeof createImageBitmap !== "function") return Promise.resolve(null);
  try {
    return createImageBitmap(canvas, { resizeWidth: wide, resizeHeight: high, resizeQuality: "medium" }).catch(
      () => null,
    );
  } catch {
    return Promise.resolve(null);
  }
}
