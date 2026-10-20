// SPDX-License-Identifier: Apache-2.0
/**
 * The render of one index job in the lab page: the frame of a `FrameKeyInput` at a size, with the metric values of
 * its frame. The labs core draws the frame without a seek (`ViewHandle.shots`), and the page encodes it as WebP (JPEG
 * in WebKit). The shadow frame of the workbench renders the jobs of the host queue with it (the bridge call
 * `indexJob`). The lab page alone fills its own store with it (selfFill.ts).
 *
 * The page draws a job only with its own scene options: the tunes, the renderer options, the tier, the backend and
 * the content hash of the job must be those of the page (the core has one set of them). A job of a view track needs
 * that track in the page.
 */
import type { FrameKeyInput } from "@scenity/labs-platform/frameKey";
import { metricsRecord } from "@scenity/labs-platform/indexRead";
import { encodePicture } from "../bridge/workbenchCapture";
import { editorRoom, editorScene, type TrackSource } from "../sceneSource";
import type { LabEvent } from "../sequence";
import type { ViewHandle } from "../useLabStats";
import { cameraOfFrameView, indexHeight, samePageOptions } from "./frameInput";

/** The WebP quality of an index picture (the strip of the dock uses 0.8 too). */
export const INDEX_QUALITY = 0.8;

/** A rendered job: the picture and the metric values of its frame. */
export interface RenderedJob {
  readonly simMs: number;
  readonly width: number;
  readonly height: number;
  readonly mime: string;
  /** The bytes of the picture (the bridge moves the buffer to the workbench page). */
  readonly bytes: ArrayBuffer;
  readonly metrics: Record<string, number>;
  /**
   * The pose families that the frame called (the trace of the plugin core, `traceReads`), or null (or absent) when
   * they are unknown.
   */
  readonly reads?: readonly string[] | null;
  /** The time of the render in the page (ms): the shots, the encode and the metrics. */
  readonly ms: number;
}

/** A job that this page cannot draw (other scene options, another track): return it to the queue. */
export class JobRefused extends Error {
  override readonly name = "JobRefused";
}

/** What a render needs of the page. */
export interface JobParts {
  readonly view: () => ViewHandle | null;
  /** The input of the page at time 0 (its scene options and its content hash). */
  readonly page: () => FrameKeyInput;
  /** The view track of the page and its name, or null. */
  readonly track: () => { readonly name: string; readonly track: TrackSource } | null;
  /** True when the scene is ready and its assets settled (a frame of a loading scene never goes into the index). */
  readonly ready: () => boolean;
}

/** The track of a job: null for a take; a refusal when the page has no such track. */
function trackOf(parts: JobParts, source: string): TrackSource | null {
  if (!source.startsWith("track:")) return null;
  const loaded = parts.track();
  if (loaded?.name !== source.slice("track:".length)) throw new JobRefused(`The page has no view track ${source}.`);
  return loaded.track;
}

/** A picture of a bitmap (WebP, or JPEG where the page has no WebP encoder). The bitmap closes. */
async function encodeBitmap(bitmap: ImageBitmap): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("bitmaprenderer");
  if (context === null) {
    bitmap.close();
    throw new Error("The page has no bitmap renderer context.");
  }
  context.transferFromImageBitmap(bitmap);
  return encodePicture((type, quality) => canvas.convertToBlob({ type, quality }), INDEX_QUALITY);
}

/** Draw the frame of an input at a width (16:10). The result has its picture and its metric values. */
export async function renderJob(parts: JobParts, input: FrameKeyInput, width: number): Promise<RenderedJob> {
  const start = performance.now();
  const view = parts.view();
  if (view?.shots === undefined) throw new JobRefused("The page has no labs renderer (runtime=1 or no view).");
  if (!parts.ready()) throw new JobRefused("The scene of the page is not ready.");
  if (!samePageOptions(input, parts.page())) throw new JobRefused("The job has other scene options than the page.");
  // On a busy machine, the adaptive quality can draw a lower tier or still poses. Such a frame does not agree with
  // the key.
  const quality = view.quality();
  if (quality !== null && (quality.tier !== input.tier || quality.still)) {
    throw new JobRefused("The adaptive quality of the page draws another tier now.");
  }
  const camera = cameraOfFrameView(input.view);
  if (camera === undefined) throw new JobRefused("The job has an unknown view.");
  const track = trackOf(parts, input.source);
  const height = indexHeight(width);
  const sample = {
    simMs: input.timeMs,
    input: editorScene().inputAt(input.events as readonly LabEvent[], input.timeMs, track),
  };
  const shots = await view.shots({ samples: [sample], width, height, view: camera });
  const shot = shots?.[0];
  if (shot?.bitmap === null || shot?.bitmap === undefined) throw new Error("The scene gave no picture.");
  const blob = await encodeBitmap(shot.bitmap);
  return {
    simMs: shot.simMs,
    width,
    height,
    mime: blob.type === "" ? "image/webp" : blob.type,
    bytes: await blob.arrayBuffer(),
    metrics: metricsRecord(editorRoom().measure(shot.report)),
    reads: shot.families ?? null,
    ms: performance.now() - start,
  };
}
