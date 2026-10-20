// SPDX-License-Identifier: Apache-2.0
/**
 * The simulation clock of the 3D room lab: it runs, stops, runs faster or slower, and seeks. A stopped clock shows the
 * frame of its time, as a fixed frame does: the scene draws the poses of that time, not the still poses of a paused
 * session. Four times per second, the clock gives its time to the page (`displayMs`). Then the page calculates the lab
 * state of that time.
 */
import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";

export const SPEEDS = [0.1, 0.25, 0.5, 1, 2] as const;
/** The display time of the clock goes to the page this often (ms). */
const TICK_MS = 250;

export interface LabClock {
  readonly running: Ref<boolean>;
  readonly speed: Ref<number>;
  /** The time of the clock at the last tick (reactive). */
  readonly displayMs: Ref<number>;
  /** The seek count. At each seek, the scene takes the new time immediately, also for a small step back. */
  readonly epoch: Ref<number>;
  /**
   * The loop of the time line between A and B (ms), or null. The time line returns to A when a running clock passes B
   * (LabTimeline.vue). The review tab sets the loop around the moment of a clip.
   */
  readonly loopFrom: Ref<number | null>;
  readonly loopTo: Ref<number | null>;
  /** The current time of the clock (not reactive): the scene reads it at each frame. */
  simNow(): number;
  play(): void;
  pause(): void;
  toggle(): void;
  setSpeed(value: number): void;
  /** Go to a time. A running clock continues to run, and a stopped clock stays stopped. */
  seek(ms: number): void;
}

export function useLabClock(options: { readonly startMs: number; readonly running: boolean }): LabClock {
  const running = ref(options.running);
  const speed = ref<number>(1);
  let baseSimMs = Math.max(0, options.startMs);
  let baseWallMs = performance.now();

  function simNow(): number {
    return running.value ? baseSimMs + (performance.now() - baseWallMs) * speed.value : baseSimMs;
  }

  const displayMs = ref(simNow());
  const epoch = ref(0);
  const loopFrom = ref<number | null>(null);
  const loopTo = ref<number | null>(null);

  function rebase(): void {
    baseSimMs = simNow();
    baseWallMs = performance.now();
  }

  function seek(ms: number): void {
    baseSimMs = Math.max(0, ms);
    baseWallMs = performance.now();
    epoch.value += 1;
    displayMs.value = baseSimMs;
  }

  let ticker: ReturnType<typeof setInterval> | null = null;
  onMounted(() => {
    ticker = setInterval(() => {
      displayMs.value = simNow();
    }, TICK_MS);
  });
  onBeforeUnmount(() => {
    if (ticker !== null) clearInterval(ticker);
  });

  return {
    running,
    speed,
    displayMs,
    epoch,
    loopFrom,
    loopTo,
    simNow,
    play() {
      if (running.value) return;
      rebase();
      running.value = true;
    },
    pause() {
      if (!running.value) return;
      rebase();
      running.value = false;
      displayMs.value = baseSimMs;
    },
    toggle() {
      rebase();
      running.value = !running.value;
      displayMs.value = baseSimMs;
    },
    setSpeed(value: number) {
      rebase();
      speed.value = value;
    },
    seek,
  };
}
