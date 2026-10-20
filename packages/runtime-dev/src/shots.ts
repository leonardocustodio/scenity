// SPDX-License-Identifier: Apache-2.0
/**
 * The pictures of the frame index without a seek: the labs core draws the frame of each sample at a size and a view in
 * one task, copies the canvas, and draws the frame of the page again in the same task. The browser shows only the last
 * drawing of a task, so the person sees no other time, and the clock of the page does not move. Each picture has the
 * inspect report of its frame (the metrics of the index).
 */
import type { CameraView } from "@scenity/runtime/framing";
import type { InspectReport } from "./inspect";
import type { SweepSample } from "./sweep";

/** A request of index pictures: the samples (time order), the size of each picture and the view (null: framing). */
export interface ShotRequest<Input = unknown> {
  readonly samples: readonly SweepSample<Input>[];
  readonly width: number;
  readonly height: number;
  readonly view: CameraView | null;
}

/** One picture of the index: the time, the picture (null when the copy failed) and the report of its frame. */
export interface IndexShot<Report extends InspectReport = InspectReport> {
  readonly simMs: number;
  readonly bitmap: ImageBitmap | null;
  readonly report: Report;
  /**
   * The pose families that the core called for the frame (the trace of the plugin core, `traceReads`), or null
   * when the trace did not see them. Absent in an answer of an older core.
   */
  readonly families?: readonly string[] | null;
}

/** The largest side of an index picture (px). */
export const MAX_SHOT_SIDE = 2048;

/** True for a request that the core can draw: 1 to 16 samples and a size from 1 to MAX_SHOT_SIDE px. */
export function validShotRequest(request: ShotRequest): boolean {
  const side = (value: number): boolean => Number.isInteger(value) && value > 0 && value <= MAX_SHOT_SIDE;
  return request.samples.length > 0 && request.samples.length <= 16 && side(request.width) && side(request.height);
}
