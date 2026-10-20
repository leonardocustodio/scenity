// SPDX-License-Identifier: Apache-2.0
// Adaptive quality of a scene. Slow windows lower the render scale, then the tier, then give still poses and at last
// the 2D view. A long good run raises the quality again, never above the first tier. Late frames of the page or the
// second view count, but a steady 30 fps page does not. A scene that must move but draws too few frames is slow.
import { describe, expect, it } from "bun:test";
import {
  ADAPT_START,
  adaptQuality,
  GOOD_TO_RAISE,
  isLate,
  MIN_FRAMES,
  qualityLadder,
  SLOW_TO_LOWER,
  type AdaptAction,
  type AdaptState,
  type Cadence,
  type FrameWindow,
} from "../src/adapt";

const STEADY_60 = { p50: 16.7, p95: 17.2 };
const STEADY_30 = { p50: 33.3, p95: 34 };
const DROPPING = { p50: 16.7, p95: 50 };

/** A window of a moving scene. `second` gives the frames of the second view. */
function framesOf(frames: number, intervalP95: number, page: Cadence | null, second: Cadence | null): FrameWindow {
  return { frames, intervalP95, page, second, moving: true };
}

const SLOW: FrameWindow = framesOf(30, 60, STEADY_60, null);
const GOOD: FrameWindow = framesOf(60, 16.8, STEADY_60, STEADY_60);

function run(state: AdaptState, window: FrameWindow, count: number, ladder = qualityLadder("high")) {
  const actions: AdaptAction[] = [];
  let current = state;
  for (let index = 0; index < count; index += 1) {
    const result = adaptQuality(current, window, ladder);
    current = result.state;
    actions.push(result.action);
  }
  return { state: current, actions };
}

describe("adaptive quality", () => {
  it("has the scales of each tier from the first tier down", () => {
    expect(qualityLadder("high").map((level) => `${level.tier}:${String(level.scale)}`)).toEqual([
      "high:1",
      "high:0.85",
      "high:0.7",
      "medium:1",
      "medium:0.85",
      "medium:0.7",
      "low:1",
      "low:0.85",
      "low:0.7",
    ]);
    expect(qualityLadder("low")).toHaveLength(3);
    expect(
      qualityLadder("ultra")
        .slice(0, 4)
        .map((level) => `${level.tier}:${String(level.scale)}`),
    ).toEqual(["ultra:1", "ultra:0.85", "ultra:0.7", "high:1"]);
    expect(qualityLadder("ultra")).toHaveLength(12);
  });

  it("gives the ultra tier the paint period of the page as its budget (no frame cap)", () => {
    const ladder = qualityLadder("ultra");
    const at120 = { p50: 8.3, p95: 8.6 };
    // 120 Hz paint and scene frames at 120 fps: good. Scene frames at 60 fps behind a 120 Hz paint: slow.
    const fast: FrameWindow = framesOf(180, 8.6, at120, null);
    const behind: FrameWindow = framesOf(90, 16.8, at120, null);
    expect(run(ADAPT_START, fast, 2, ladder).actions).toEqual(["none", "none"]);
    expect(run(ADAPT_START, behind, 2, ladder).actions).toEqual(["none", "lower"]);
    // Without the page, the budget is a 60 Hz frame.
    const noPage: FrameWindow = framesOf(90, 16.8, null, null);
    expect(run(ADAPT_START, noPage, 2, ladder).actions).toEqual(["none", "none"]);
  });

  it("calls frames late when they drop or stall, not when they are steady at 30 fps", () => {
    expect(isLate(STEADY_60)).toBe(false);
    expect(isLate(STEADY_30)).toBe(false);
    expect(isLate(DROPPING)).toBe(true);
    expect(isLate({ p50: 1500, p95: 1500 })).toBe(true);
    expect(isLate(null)).toBe(false);
  });

  it("lowers one step after two slow windows in a row (3 s)", () => {
    const { state, actions } = run(ADAPT_START, SLOW, SLOW_TO_LOWER);
    expect(actions).toEqual(["none", "lower"]);
    expect(state.step).toBe(1);
  });

  it("counts late frames of the page or the second view", () => {
    expect(run(ADAPT_START, { ...GOOD, page: DROPPING }, 2).actions).toEqual(["none", "lower"]);
    expect(run(ADAPT_START, framesOf(60, 16.8, STEADY_60, DROPPING), 2).actions).toEqual(["none", "lower"]);
  });

  it("keeps the quality in a browser that paints at a steady 30 fps (Energy Saver)", () => {
    const energySaver: FrameWindow = framesOf(45, 34, STEADY_30, STEADY_30);
    expect(run(ADAPT_START, energySaver, 10).actions.every((action) => action === "none")).toBe(true);
  });

  it("goes to still poses after the lowest step, then to the 2D room when the page stays slow", () => {
    const ladder = qualityLadder("low");
    let { state } = run(ADAPT_START, SLOW, SLOW_TO_LOWER * (ladder.length - 1), ladder);
    expect(state.step).toBe(ladder.length - 1);
    const still = run(state, SLOW, SLOW_TO_LOWER, ladder);
    expect(still.actions.at(-1)).toBe("still");
    state = still.state;
    expect(state.still).toBe(true);
    // Still poses: few scene frames. The page and the second view decide.
    const page = run(state, framesOf(1, 0, DROPPING, null), 2, ladder);
    expect(page.actions).toEqual(["none", "fallback"]);
  });

  it("raises one step after a long good run, never above the first tier", () => {
    const lowered = run(ADAPT_START, SLOW, SLOW_TO_LOWER).state;
    const good = run(lowered, GOOD, GOOD_TO_RAISE);
    expect(good.actions.at(-1)).toBe("raise");
    expect(good.state.step).toBe(0);
    const more = run(good.state, GOOD, GOOD_TO_RAISE * 2);
    expect(more.actions.every((action) => action === "none")).toBe(true);
  });

  it("decides nothing without motion (a pause, reduced motion, a hidden scene, a clock that stands still)", () => {
    expect(run(ADAPT_START, { ...SLOW, moving: false }, 5).actions.every((action) => action === "none")).toBe(true);
    expect(run(ADAPT_START, { ...SLOW, frames: 2, moving: false }, 5).actions.every((a) => a === "none")).toBe(true);
  });

  it("counts a scene that must move but draws too few frames as slow", () => {
    // A starved render worker: 2 frames in 1.5 s while the case runs. The page and the second view are on time.
    const starved: FrameWindow = framesOf(2, 0, STEADY_60, STEADY_60);
    expect(MIN_FRAMES).toBe(5);
    expect(run(ADAPT_START, starved, SLOW_TO_LOWER).actions).toEqual(["none", "lower"]);
    // The step does not raise the quality again: a starved window is never good.
    const lowered = run(ADAPT_START, starved, SLOW_TO_LOWER).state;
    expect(run(lowered, { ...starved, frames: 4 }, GOOD_TO_RAISE).actions.includes("raise")).toBe(false);
  });

  it("judges the medium tier against its 30 fps cap", () => {
    const ladder = qualityLadder("medium");
    const atCap: FrameWindow = framesOf(30, 34, STEADY_60, null);
    expect(run(ADAPT_START, atCap, 4, ladder).actions.every((action) => action === "none")).toBe(true);
  });
});
