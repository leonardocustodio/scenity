// SPDX-License-Identifier: Apache-2.0
/**
 * The model of the Frame index panel: the frames of the list of the project (the dev server
 * route `frames.json`, scripts/frameIndexApi.ts) by plan (a sequence, or a scene with no sequence), camera and time.
 * Each place (a plan, a camera, a time) has its newest picture and the picture before it, when the list keeps one.
 */

/** A frame of the list, with its stale mark. */
export interface FrameRow {
  readonly key: string;
  readonly plan: string;
  readonly scene: string;
  readonly sequence: string | null;
  readonly camera: string | null;
  readonly time: number;
  readonly moment: boolean;
  readonly made: string;
  /** True when the key is not a key of the project files now. */
  readonly stale: boolean;
}

/** The state of the index of the project. */
export interface FrameIndexState {
  readonly running: boolean;
  readonly log: readonly string[];
  readonly code: number | null;
  /** The count of the frames of the project now. */
  readonly wanted: number;
  readonly frames: readonly FrameRow[];
  readonly error?: string;
}

/** One place of the grid: its newest picture, and the picture before it (or null). */
export interface FrameCell {
  readonly newest: FrameRow;
  readonly before: FrameRow | null;
}

/** The plans of the list, in the order of their first frame. */
export function plansOf(frames: readonly FrameRow[]): string[] {
  return [...new Set(frames.map((frame) => frame.plan))];
}

/** The cameras of a plan (null: the camera of the scene). */
export function camerasOf(frames: readonly FrameRow[], plan: string): (string | null)[] {
  return [...new Set(frames.filter((frame) => frame.plan === plan).map((frame) => frame.camera))];
}

/** The times of a plan, from the first to the last. */
export function timesOf(frames: readonly FrameRow[], plan: string): number[] {
  return [...new Set(frames.filter((frame) => frame.plan === plan).map((frame) => frame.time))].sort((a, b) => a - b);
}

/** The place of a plan, a camera and a time, or null when the list has no picture of it. */
export function cellOf(
  frames: readonly FrameRow[],
  plan: string,
  camera: string | null,
  time: number,
): FrameCell | null {
  const here = frames
    .filter((frame) => frame.plan === plan && frame.camera === camera && frame.time === time)
    .sort((a, b) => b.made.localeCompare(a.made));
  const newest = here[0];
  return newest === undefined ? null : { newest, before: here[1] ?? null };
}

/** The name of a plan for the panel: the file name of its sequence or scene. */
export function planName(plan: string): string {
  const path = plan.replace(/^(sequence|scene):/, "");
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.(sequence|scene)\.json$/, "");
}

/** The two frames to compare: a new pick replaces the older of two. */
export function pick(picked: readonly string[], key: string): string[] {
  if (picked.includes(key)) return picked.filter((each) => each !== key);
  return [...picked, key].slice(-2);
}
