// SPDX-License-Identifier: Apache-2.0
/**
 * The `capture` call of the workbench bridge. It gives the frame that the scene draws as WebP bytes. The frame comes
 * from `ViewHandle.capture` (the labs renderer, the worker or the main-thread core). The frame strip of the dock
 * encodes its pictures the same way (browser/useFrameStrip.ts).
 *
 * The bytes go to the page as an `ArrayBuffer` in the transfer list of `postMessage` (workbenchBridge.ts), not as
 * base64. The page checks its WebP encoder one time (a 1 × 1 canvas). WebKit has no WebP encoder, so a capture there
 * gives a JPEG directly and does not encode a PNG first.
 */
import { captureArgsOf, type BridgeCapture } from "@scenity/bridge";
import { resetLabsPlatform, webpEncode } from "@scenity/labs-platform";
import type { CaptureTarget } from "@scenity/runtime-dev";
import type { ViewHandle } from "../useLabStats";
/** The quality of the WebP encoder: high, so a capture compares with a screenshot (the gallery tolerance). */
const WEBP_QUALITY = 0.92;

/** The quality of the JPEG picture of a browser without a WebP encoder. A PNG of 1280 px is approximately 1 MB. */
export const JPEG_QUALITY = 0.9;

/** The WebP check of a page: true when a canvas of the page encodes real WebP. */
export type WebpCheck = () => Promise<boolean>;

/**
 * True when a canvas of this page encodes WebP. This is the check of `@scenity/labs-platform`, which encodes a 1 × 1
 * canvas one time for each page. WebKit gives a PNG for a WebP request, so the answer there is false.
 */
export const webpOnce: WebpCheck = () => webpEncode();

/** Forget the answer of the WebP check (the tests). */
export function resetWebpCheck(): void {
  resetLabsPlatform();
}

/**
 * Encode a picture as WebP. In a browser without a WebP encoder (WebKit, the Tauri window), the picture is a JPEG
 * directly. The check of the page tells which browser has no WebP encoder. A JPEG request that gives another type
 * keeps that type (PNG as the last alternative).
 */
export async function encodePicture(
  encodeAs: (type: string, quality: number) => Promise<Blob>,
  quality: number,
  webp: WebpCheck = webpOnce,
): Promise<Blob> {
  if (await webp()) {
    const blob = await encodeAs("image/webp", quality);
    if (blob.type === "image/webp" || blob.type === "") return blob;
  }
  return encodeAs("image/jpeg", JPEG_QUALITY);
}

/**
 * A picture of a bitmap as WebP (or JPEG, see `encodePicture`), or as PNG when `png` is true. The WebKit pages of the
 * render pool use the PNG for a tool shot. The function closes the bitmap.
 */
async function encode(bitmap: ImageBitmap, quality: number, png = false): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("bitmaprenderer");
  if (context === null) {
    bitmap.close();
    throw new Error("capture: the page has no bitmap renderer context.");
  }
  context.transferFromImageBitmap(bitmap);
  if (png) return canvas.convertToBlob({ type: "image/png" });
  return encodePicture((type, level) => canvas.convertToBlob({ type, quality: level }), quality);
}

/** True when the target of a capture asks for a PNG (`{ mime: "image/png" }`). */
export function wantsPng(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as { mime?: unknown }).mime === "image/png";
}

/**
 * The pane or the grid of a capture: `{ pane: n }`, `{ grid: true }`, or nothing (the main pane). `{ onion: true }`
 * shows the onion skin in the picture (`lab_frame { onion: true }`). `{ hidden: true }` draws the picture with the
 * solo and hide state of its pane (`lab_frame { hidden: true }`).
 */
export function captureTarget(value: unknown): CaptureTarget {
  if (value === undefined || value === null) return {};
  const args = (typeof value === "object" ? value : {}) as {
    pane?: unknown;
    grid?: unknown;
    onion?: unknown;
    hidden?: unknown;
  };
  const pane = args.pane === undefined || args.pane === null ? undefined : Number(args.pane);
  if (pane !== undefined && !(Number.isInteger(pane) && pane >= 0 && pane <= 3)) {
    throw new Error("capture: the pane must be an integer from 0 to 3.");
  }
  if (args.grid === true && pane !== undefined) throw new Error("capture: give a pane or the grid, not both.");
  const onion = typeof args.onion === "boolean" ? { onion: args.onion } : {};
  const hidden = args.hidden === true ? { hidden: true } : {};
  return {
    ...(pane === undefined ? {} : { pane }),
    ...(args.grid === true ? { grid: true } : {}),
    ...onion,
    ...hidden,
  };
}

/**
 * Capture the frame of the scene at a width and a WebP quality from 0 to 1. The width is in px, and its default is
 * `DEFAULT_CAPTURE_WIDTH` of `@scenity/bridge`. The default quality is WEBP_QUALITY, and 1 gives a lossless picture
 * in Chromium. With a `height`, the scene draws the picture at `width` × `height` with the camera framed for that
 * aspect. Thus a thin frame (a narrow window with the Claude column under the lab) also gives a full picture. Without a
 * height, the picture has the aspect of the canvas. With the split screen, `target` is `{ pane }` (one pane; the
 * default is the main pane) or `{ grid: true }` (the full canvas). With `mime: "image/png"` in `target`, the picture
 * is a PNG.
 */
export async function captureFrame(
  view: ViewHandle | null,
  width?: unknown,
  quality?: unknown,
  height?: unknown,
  target?: unknown,
): Promise<BridgeCapture> {
  // The checks of the arguments are the contract of the base call `capture` (`@scenity/bridge`).
  const [asked, askedQuality, tall] = captureArgsOf([width, quality, height]);
  const level = askedQuality ?? WEBP_QUALITY;
  if (view === null) throw new Error("capture: the lab has no 3D view now.");
  const where = captureTarget(target);
  const shot = await (tall > 0 ? view.capture(asked, tall, where) : view.capture(asked, undefined, where));
  if (shot?.bitmap === null || shot?.bitmap === undefined) {
    throw new Error("capture: the scene gave no picture (no canvas, or the runtime renderer of `runtime=1`).");
  }
  const { width: outWidth, height: outHeight } = shot.bitmap;
  const blob = await encode(shot.bitmap, level, wantsPng(target));
  return {
    simMs: shot.simMs,
    width: outWidth,
    height: outHeight,
    mime: blob.type === "" ? "image/webp" : blob.type,
    // One copy (the Blob to its buffer). The bridge moves the buffer to the page.
    bytes: await blob.arrayBuffer(),
  };
}
