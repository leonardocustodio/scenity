// SPDX-License-Identifier: Apache-2.0
/**
 * Adaptive quality of a scene. The host measures the scene in windows of WINDOW_MS: the frame intervals of the render
 * worker and the frame intervals of the page and of a second view of the page (they share the GPU and the main thread
 * with the scene). The function is pure: one window in, the next state and one action out.
 *
 * - Late frames, not a low frame rate, make a page or a second view slow: their 95th percentile interval is more
 *   than LATE_RATIO times their median (and more than LATE_MIN_MS). A browser that paints at 30 fps on
 *   purpose (Chrome Energy Saver, a 30 Hz display, a window in the background) has steady frames and is not
 *   slow; a busy page drops frames and is. A page that paints slower than every STALL_MS is slow too.
 * - Slow: the scene frames come later than 1.5 times their budget — the frame cap of the tier, or the paint
 *   period of the page when the page paints slower than the cap — or the page or the second view has late frames
 *   (the downgrade rule). Two slow windows in a row (3 s) lower the quality by one step: the render
 *   scale first (1, 0.85, 0.7), then the tier. The scene steps down before the second view.
 * - At the lowest step, two more slow windows give still poses (one frame per change); two windows of late
 *   page or second-view frames after that give the 2D view ("fallback", with the notice of the host).
 * - Good: the scene holds its budget and the page and the second view have no late frames. After GOOD_TO_RAISE
 *   good windows in a row (30 s), the quality increases by one step, never above the first tier of the GPU probe.
 * - A window without motion (a pause, reduced motion, a hidden scene, a simulation clock that stands still)
 *   decides nothing. A window with motion but fewer than MIN_FRAMES scene frames is slow: the render worker does not
 *   get enough time. Without this rule, such a scene keeps its quality while it draws fewer than 3.3 frames per second.
 */
import type { Tier } from "./protocol";

/** The length of one measurement window in ms. */
export const WINDOW_MS = 1500;
/** Slow windows in a row before a step down (3 s). */
export const SLOW_TO_LOWER = 2;
/** Good windows in a row before a step up (30 s). */
export const GOOD_TO_RAISE = 20;
/** Frames are late when the 95th percentile interval is this many times the median… */
export const LATE_RATIO = 1.5;
/** …and longer than this (a 60 Hz frame and one dropped frame are not late). */
export const LATE_MIN_MS = 25;
/** A median frame interval over this (under 10 fps) is a stalled page or second view. */
export const STALL_MS = 100;
/** A window with motion and fewer scene frames than this (about 3.3 frames per second) is slow. */
export const MIN_FRAMES = 5;
/** The render scales of a tier, from the best to the worst. */
export const SCALES: readonly number[] = [1, 0.85, 0.7];
/** The frame cap of each tier (frames per second). The ultra tier has no cap (Infinity). */
export const TIER_FPS: Readonly<Record<Tier, number>> = {
  ultra: Number.POSITIVE_INFINITY,
  high: 60,
  medium: 30,
  low: 30,
};
/** The frame budget of a tier without a cap when the paint period of the page is not known (60 Hz). */
const UNCAPPED_BUDGET_MS = 1000 / 60;

/** The quality tiers from the best to the lowest: the one list of the tiers. */
export const TIER_ORDER: readonly Tier[] = ["ultra", "high", "medium", "low"];

export interface QualityLevel {
  readonly tier: Tier;
  readonly scale: number;
}

/** The quality steps from the first tier (the GPU probe) down to the lowest: tier by tier, scale by scale. */
export function qualityLadder(first: Tier): QualityLevel[] {
  return TIER_ORDER.slice(TIER_ORDER.indexOf(first)).flatMap((tier) => SCALES.map((scale) => ({ tier, scale })));
}

export interface AdaptState {
  /** The index of the current step in the ladder. */
  readonly step: number;
  /** Still poses (the step after the lowest quality). */
  readonly still: boolean;
  readonly slow: number;
  readonly good: number;
}

export const ADAPT_START: AdaptState = { step: 0, still: false, slow: 0, good: 0 };

/** The median and the 95th percentile of frame intervals in ms. */
export interface Cadence {
  readonly p50: number;
  readonly p95: number;
}

/** True when a cadence has late frames (see the module comment). */
export function isLate(cadence: Cadence | null): boolean {
  if (cadence === null) return false;
  return cadence.p50 > STALL_MS || (cadence.p95 > LATE_MIN_MS && cadence.p95 > LATE_RATIO * cadence.p50);
}

/** One measurement window. */
export interface FrameWindow {
  /** Scene frames in the window. */
  readonly frames: number;
  /** The 95th percentile of the scene frame intervals in ms. */
  readonly intervalP95: number;
  /** The frame intervals of the page in the window, or null without a measurement. */
  readonly page: Cadence | null;
  /** The frame intervals of the second view of the page, or null without one. */
  readonly second: Cadence | null;
  /**
   * The scene must move: it runs, it shows, the viewer has no reduced motion, and the simulation clock continued in
   * the window.
   */
  readonly moving: boolean;
}

export type AdaptAction = "none" | "lower" | "raise" | "still" | "fallback";

export function adaptQuality(
  state: AdaptState,
  window: FrameWindow,
  ladder: readonly QualityLevel[],
): { readonly state: AdaptState; readonly action: AdaptAction } {
  const level = ladder[Math.min(state.step, ladder.length - 1)] ?? { tier: "low", scale: 0.7 };
  const second = window.second;
  const late = isLate(window.page) || isLate(second);
  if (state.still) {
    // Still poses: the scene draws on change only, so the page and the second view decide.
    if (window.page === null && second === null) return { state, action: "none" };
    if (!late) return { state: { ...state, slow: 0 }, action: "none" };
    const slow = state.slow + 1;
    return slow >= SLOW_TO_LOWER
      ? { state: { ...state, slow: 0 }, action: "fallback" }
      : { state: { ...state, slow }, action: "none" };
  }
  if (!window.moving) return { state, action: "none" };
  // The budget of a scene frame: the frame cap of the tier, or the paint period of the page when it is longer. A tier
  // without a cap has the paint period of the page as its budget.
  const cap = TIER_FPS[level.tier];
  const budget = Number.isFinite(cap)
    ? Math.max(1000 / cap, window.page?.p50 ?? 0)
    : (window.page?.p50 ?? UNCAPPED_BUDGET_MS);
  const starved = window.frames < MIN_FRAMES;
  const slowWindow = starved || window.intervalP95 > 1.5 * budget || late;
  const goodWindow = !starved && window.intervalP95 <= 1.15 * budget && !late;
  if (slowWindow) {
    const slow = state.slow + 1;
    if (slow < SLOW_TO_LOWER) return { state: { ...state, slow, good: 0 }, action: "none" };
    if (state.step < ladder.length - 1) {
      return { state: { ...state, step: state.step + 1, slow: 0, good: 0 }, action: "lower" };
    }
    return { state: { ...state, still: true, slow: 0, good: 0 }, action: "still" };
  }
  if (goodWindow) {
    const good = state.good + 1;
    if (good >= GOOD_TO_RAISE && state.step > 0) {
      return { state: { ...state, step: state.step - 1, slow: 0, good: 0 }, action: "raise" };
    }
    return { state: { ...state, slow: 0, good }, action: "none" };
  }
  return { state: { ...state, slow: 0, good: 0 }, action: "none" };
}
