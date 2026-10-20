// SPDX-License-Identifier: Apache-2.0
/**
 * The state of the compare view: two sides on one linked clock. A seek, a step, a camera or a new side asks both sides
 * for the frame of the same time. The newest request wins, so a fast scrub shows the last time and not a queue of old
 * times. Play steps the linked clock by 100 ms after both frames of a time arrive (at most the speed of the clock).
 * With the index, both sides play at the frame rate of the index. With the hidden lab, they play at the speed of its
 * draws.
 */
import { ref, shallowRef, type Ref, type ShallowRef } from "vue";
import type { FrameShot } from "./compareFrames";
import type { CompareSide } from "./sources";

/** The step of the linked clock: the step of the index. */
export const COMPARE_STEP_MS = 100;

export interface CompareParts {
  readonly frame: (side: CompareSide, timeMs: number, camera: string) => Promise<FrameShot>;
  readonly a: CompareSide | null;
  readonly b: CompareSide | null;
  readonly timeMs: number;
  readonly camera: string;
  /** The end of the time range (ms). */
  readonly end: (a: CompareSide | null, b: CompareSide | null) => number;
}

export interface CompareState {
  readonly a: Ref<CompareSide | null>;
  readonly b: Ref<CompareSide | null>;
  readonly timeMs: Ref<number>;
  readonly camera: Ref<string>;
  readonly playing: Ref<boolean>;
  readonly shots: ShallowRef<{ readonly a: FrameShot | null; readonly b: FrameShot | null }>;
  /** The simulation time that both shots show, or null while a side loads. */
  readonly shown: Ref<number | null>;
  readonly busy: Ref<boolean>;
  /** The time of the last pair of frames (ms). */
  readonly pairMs: Ref<number | null>;
  seek(ms: number): Promise<void>;
  step(delta: number): Promise<void>;
  setCamera(name: string): Promise<void>;
  setSide(which: "a" | "b", side: CompareSide | null): Promise<void>;
  play(): void;
  pause(): void;
  end(): number;
}

/** The refs of a pair of frames that `pairLoader` fills. */
interface PairRefs {
  readonly a: Ref<CompareSide | null>;
  readonly b: Ref<CompareSide | null>;
  readonly timeMs: Ref<number>;
  readonly camera: Ref<string>;
  readonly shots: ShallowRef<{ readonly a: FrameShot | null; readonly b: FrameShot | null }>;
  readonly shown: Ref<number | null>;
  readonly busy: Ref<boolean>;
  readonly pairMs: Ref<number | null>;
}

/** Ask both sides for the frame of the linked time. An older request stops at its next step. */
function pairLoader(frame: CompareParts["frame"], refs: PairRefs): () => Promise<void> {
  let generation = 0;
  return async () => {
    const mine = ++generation;
    const at = refs.timeMs.value;
    const view = refs.camera.value;
    const start = performance.now();
    refs.busy.value = true;
    refs.shown.value = null;
    const next: { a: FrameShot | null; b: FrameShot | null } = { a: null, b: null };
    for (const which of ["a", "b"] as const) {
      const side = which === "a" ? refs.a.value : refs.b.value;
      next[which] = side === null ? null : await frame(side, at, view);
      if (mine !== generation) return;
    }
    refs.shots.value = next;
    refs.shown.value = at;
    refs.busy.value = false;
    refs.pairMs.value = performance.now() - start;
  };
}

export function useCompare(parts: CompareParts): CompareState {
  const refs: PairRefs = {
    a: ref<CompareSide | null>(parts.a),
    b: ref<CompareSide | null>(parts.b),
    timeMs: ref(parts.timeMs),
    camera: ref(parts.camera),
    shots: shallowRef<{ a: FrameShot | null; b: FrameShot | null }>({ a: null, b: null }),
    shown: ref<number | null>(null),
    busy: ref(false),
    pairMs: ref<number | null>(null),
  };
  const { a, b, timeMs, camera } = refs;
  const playing = ref(false);
  const refresh = pairLoader(parts.frame, refs);
  const end = () => parts.end(a.value, b.value);
  const clamp = (ms: number) => Math.min(end(), Math.max(0, Math.round(ms)));

  async function seek(ms: number): Promise<void> {
    timeMs.value = clamp(ms);
    await refresh();
  }

  async function playLoop(): Promise<void> {
    while (playing.value) {
      const start = performance.now();
      if (timeMs.value >= end()) {
        playing.value = false;
        return;
      }
      await seek(timeMs.value + COMPARE_STEP_MS);
      const wait = COMPARE_STEP_MS - (performance.now() - start);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  return {
    ...refs,
    playing,
    seek,
    step: (delta) => seek(timeMs.value + delta),
    async setCamera(name) {
      camera.value = name;
      await refresh();
    },
    async setSide(which, side) {
      if (which === "a") a.value = side;
      else b.value = side;
      timeMs.value = clamp(timeMs.value);
      await refresh();
    },
    play() {
      if (playing.value) return;
      playing.value = true;
      void playLoop();
    },
    pause() {
      playing.value = false;
    },
    end,
  };
}
