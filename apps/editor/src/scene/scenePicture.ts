// SPDX-License-Identifier: Apache-2.0
/**
 * The pictures of the scene page for the workbench bridge: a bitmap of the camera preview of the dev core as WebP bytes
 * (JPEG in a browser without a WebP encoder). The base call `capture`, the contact sheet (sceneSheet.ts) and the jobs
 * of the frame index (sceneIndex.ts) use it.
 */
import { encodePicture } from "../core/bridge/workbenchCapture";

/** The WebP quality of a picture of the page. */
export const PICTURE_QUALITY = 0.92;

/** An encoded picture: its size, its type and its bytes. */
export interface PagePicture {
  readonly width: number;
  readonly height: number;
  readonly mime: string;
  readonly bytes: ArrayBuffer;
}

/** Draw a canvas into a blob of the picture type of the page. */
export async function encodeCanvas(canvas: OffscreenCanvas, quality = PICTURE_QUALITY): Promise<PagePicture> {
  const blob = await encodePicture((type, level) => canvas.convertToBlob({ type, quality: level }), quality);
  return {
    width: canvas.width,
    height: canvas.height,
    mime: blob.type === "" ? "image/webp" : blob.type,
    bytes: await blob.arrayBuffer(),
  };
}

/** Encode a bitmap; the bitmap closes. */
export async function encodeBitmap(bitmap: ImageBitmap, quality = PICTURE_QUALITY): Promise<PagePicture> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("bitmaprenderer");
  if (context === null) {
    bitmap.close();
    throw new Error("the page has no bitmap renderer context.");
  }
  context.transferFromImageBitmap(bitmap);
  return encodeCanvas(canvas, quality);
}
