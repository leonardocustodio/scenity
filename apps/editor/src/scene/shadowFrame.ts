// SPDX-License-Identifier: Apache-2.0
/**
 * The shadow frame of the scene page: a picture for an agent that does not change the view of the person. The page
 * renders the camera off the screen (the camera preview of the core), so the camera of the view does not move. A time
 * from the agent applies only to the picture. The core poses the scene at that time for the preview. Then it poses
 * the scene at the time of the page clock again, before the frame of the page (a clock of its own). Thus the canvas
 * never shows that time, and the clock does not change. The selection also does not change.
 */
import type { BridgeCapture, ShadowFrameRequest } from "@scenity/bridge";
import { encodeBitmap, PICTURE_QUALITY } from "./scenePicture";

/** What the shadow frame reads of the page. */
export interface ShadowParts {
  /** The document camera of the view, or null for the editor camera. */
  camera(): string | null;
  /** A picture of a camera off the screen at a given time (null: the time of the page), or null for no picture. */
  preview(camera: string | null, width: number, at?: number | null): Promise<ImageBitmap | null>;
  /** The time of the page clock (ms), or null for a scene with no sequence. */
  simMs(): number | null;
}

/** The default width of a picture (px). */
const WIDTH = 960;

/** Take a picture of a camera at a time. The view and the clock of the person do not change. */
export async function shadowFrame(parts: ShadowParts, request: ShadowFrameRequest): Promise<BridgeCapture> {
  const now = parts.simMs();
  if (request.t !== undefined && now === null) {
    throw new Error("shadow.frame: the scene has no sequence, so the picture takes no time; give a camera only.");
  }
  const bitmap = await parts.preview(request.camera ?? parts.camera(), request.width ?? WIDTH, request.t ?? null);
  if (bitmap === null) throw new Error(`shadow.frame: no picture of the camera "${request.camera ?? "view"}".`);
  return { simMs: request.t ?? now, ...(await encodeBitmap(bitmap, PICTURE_QUALITY)) };
}
