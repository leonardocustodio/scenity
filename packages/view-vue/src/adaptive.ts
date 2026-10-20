// SPDX-License-Identifier: Apache-2.0
/**
 * The adaptive quality of SceneView. Every WINDOW_MS the frame statistics of the renderer and the frame cadence of
 * the page and of a second view go to `adaptQuality`. The scene lowers its render scale, then its tier, then uses
 * still poses. At last it gives its place to the fallback of the host. After a long good run, it raises the quality
 * again.
 */
import {
  ADAPT_START,
  adaptQuality,
  qualityLadder,
  WINDOW_MS,
  type AdaptState,
  type Cadence,
  type QualityLevel,
} from "@scenity/runtime/adapt";
import type { SceneClient } from "@scenity/runtime/client";
import { percentile } from "@scenity/runtime/hostMath";
import type { Tier } from "@scenity/runtime/protocol";
import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef, type Ref, type ShallowRef } from "vue";

/** What the adaptive quality reads from the view. */
export interface AdaptiveSource<Input> {
  readonly renderer: ShallowRef<SceneClient<Input> | null>;
  readonly ready: Ref<boolean>;
  /** The scene is on screen and the tab is visible. */
  readonly visible: () => boolean;
  /** The first quality tier of the GPU probe. */
  readonly tier: () => Tier;
  readonly adaptive: () => boolean;
  /** The name of the User Timing mark of each window, or null for no mark. */
  readonly statsMark: () => string | null;
  readonly paused: () => boolean;
  readonly reducedMotion: () => boolean;
  /** The frame cadence of the second view of the page, or null without a measurement. */
  readonly secondCadence: () => Cadence | null;
  readonly simNow: () => number | null;
  /** Give the place to the fallback of the host. */
  readonly fail: (reason: string) => void;
}

/** The simulation clock moves in a window when it advances by more than this value (ms). */
const CLOCK_ADVANCE_MS = 100;

/** The frame intervals of the page (its cadence: late frames make the page slow), from an animation frame loop. */
function pageFrames(): { start(): void; stop(): void; take(): number[] } {
  let intervals: number[] = [];
  let last: number | null = null;
  let frame: number | null = null;
  function count(): void {
    const now = performance.now();
    if (last !== null) intervals.push(now - last);
    last = now;
    frame = requestAnimationFrame(count);
  }
  return {
    start: () => {
      if (typeof requestAnimationFrame === "function") frame = requestAnimationFrame(count);
    },
    stop: () => {
      if (frame !== null) cancelAnimationFrame(frame);
    },
    /** The intervals of the current window. A page without a frame in it (stalled) has one long interval. */
    take: () => {
      const taken = intervals;
      intervals = [];
      if (taken.length === 0) taken.push(performance.now() - (last ?? performance.now() - WINDOW_MS));
      return taken;
    },
  };
}

/** The adaptive quality: the level now and the still poses that it chose. */
export function useAdaptiveQuality<Input>(source: AdaptiveSource<Input>): {
  readonly level: ComputedRef<QualityLevel>;
  readonly forcedStill: Ref<boolean>;
} {
  const ladder = computed(() => qualityLadder(source.tier()));
  const adapt = ref<AdaptState>(ADAPT_START);
  const level = computed(() => ladder.value[adapt.value.step] ?? { tier: source.tier(), scale: 1 });
  /** Still poses that the adaptive quality chose : the scene draws only on a change. */
  const forcedStill = ref(false);
  let adaptTimer: ReturnType<typeof setInterval> | null = null;
  const pageCadence = pageFrames();
  /** The simulation time at the end of the last window: a clock that stands still gives no motion to measure. */
  let windowSimMs: number | null = null;

  function apply(made: SceneClient<Input>, action: ReturnType<typeof adaptQuality>["action"]): void {
    switch (action) {
      case "lower":
      case "raise":
        made.setTier(level.value.tier);
        made.setScale(level.value.scale);
        break;
      case "still":
        forcedStill.value = true;
        break;
      case "fallback":
        source.fail("slow");
        break;
      case "none":
        break;
    }
  }

  async function adaptWindow(): Promise<void> {
    const made = source.renderer.value;
    const mark = source.statsMark();
    if (made === null || !source.ready.value || !(source.adaptive() || mark !== null)) return;
    const stats = await made.stats(true);
    // A renderer that the view replaced (a failed worker) answers with empty statistics: no window.
    if (source.renderer.value !== made) return;
    if (mark !== null) performance.mark(mark, { detail: { ...stats, scale: level.value.scale } });
    if (!source.adaptive()) return;
    const intervals = pageCadence.take();
    const visible = source.visible();
    const page = visible ? { p50: percentile(intervals, 0.5), p95: percentile(intervals, 0.95) } : null;
    const second = source.secondCadence();
    const sim = source.simNow();
    const clockGoesOn = windowSimMs !== null && sim !== null && sim - windowSimMs > CLOCK_ADVANCE_MS;
    windowSimMs = sim;
    const moving = visible && !source.paused() && !source.reducedMotion() && clockGoesOn;
    const measured = { frames: stats.frames, intervalP95: stats.intervalP95, page, second, moving };
    const result = adaptQuality(adapt.value, measured, ladder.value);
    adapt.value = result.state;
    apply(made, result.action);
  }

  onMounted(() => {
    pageCadence.start();
    windowSimMs = source.simNow();
    adaptTimer = setInterval(() => {
      void adaptWindow();
    }, WINDOW_MS);
  });
  onBeforeUnmount(() => {
    if (adaptTimer !== null) clearInterval(adaptTimer);
    pageCadence.stop();
  });

  return { level, forcedStill };
}
