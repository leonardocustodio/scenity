// SPDX-License-Identifier: Apache-2.0
/**
 * The visible part of the time line of the sequencer: the zoom, the pan and the snaps. The window is a range of ms. A
 * zoom keeps the time under the pointer at its place, and a pan moves the range. Neither goes past 0 or the duration.
 * A drag of a key or of a marker snaps to the times near it (the clock, the markers, the other keys). Else it snaps
 * to a grid of 100 ms. Alt during the drag gives the exact time. The module has only pure functions and no DOM.
 */
import { ticksOf } from "../../core/graph/scale";

/** The visible range of the time line (ms). */
export interface TimeWindow {
  readonly from: number;
  readonly to: number;
}

/** The smallest range of a zoom (ms). */
export const MIN_SPAN = 100;
/** The grid of a snap (ms) and the distance of a snap to a time (px). */
export const SNAP_GRID = 100;
export const SNAP_PX = 6;

/** The whole time line. */
export function fullWindow(duration: number): TimeWindow {
  return { from: 0, to: Math.max(1, duration) };
}

/** The window inside 0..duration with the same span when it can. */
function clamp(from: number, span: number, duration: number): TimeWindow {
  const size = Math.min(Math.max(MIN_SPAN, span), Math.max(1, duration));
  const start = Math.min(Math.max(0, from), Math.max(0, duration - size));
  return { from: start, to: start + size };
}

/** The share (0 to 100 inside the window) of a time, for a CSS left value. */
export function windowShare(t: number, window: TimeWindow): number {
  return ((t - window.from) / Math.max(1, window.to - window.from)) * 100;
}

/** The whole ms at x px of a lane of `width` px, inside 0..duration. */
export function windowTimeAt(x: number, width: number, window: TimeWindow, duration: number): number {
  const t = window.from + (x / Math.max(1, width)) * (window.to - window.from);
  return Math.round(Math.min(Math.max(0, t), duration));
}

/** A zoom by `factor` (below 1: closer) that keeps the time `at` at its place. */
export function zoomWindow(window: TimeWindow, factor: number, at: number, duration: number): TimeWindow {
  const span = window.to - window.from;
  const next = Math.min(Math.max(MIN_SPAN, span * factor), Math.max(1, duration));
  const share = span <= 0 ? 0 : (at - window.from) / span;
  return clamp(at - share * next, next, duration);
}

/** A pan by `delta` ms. */
export function panWindow(window: TimeWindow, delta: number, duration: number): TimeWindow {
  return clamp(window.from + delta, window.to - window.from, duration);
}

/** The ticks of the ruler in the window: about eight round steps. */
export function windowTicks(window: TimeWindow): number[] {
  return ticksOf(window.from, window.to, 8).filter((tick) => tick >= window.from && tick <= window.to);
}

/**
 * The time of a drag after the snap: the nearest of `near` within SNAP_PX (`msPerPx` is the scale of the lane), else
 * the nearest step of the grid. `exact` (Alt) gives the time as it is.
 */
export function snapTime(t: number, near: readonly number[], msPerPx: number, exact: boolean): number {
  if (exact) return Math.round(t);
  const reach = SNAP_PX * msPerPx;
  let best: number | null = null;
  for (const candidate of near) {
    if (Math.abs(candidate - t) <= reach && (best === null || Math.abs(candidate - t) < Math.abs(best - t))) {
      best = candidate;
    }
  }
  return best ?? Math.round(t / SNAP_GRID) * SNAP_GRID;
}
