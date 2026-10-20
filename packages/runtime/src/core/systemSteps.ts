// SPDX-License-Identifier: Apache-2.0
/**
 * The fixed steps of the plugin systems in a document core. The systems run at 60 steps per second, at whole ms
 * (0, 17, 33, 50, ...), never at the times of the frames. Thus the system memory at a time `t` is a function of the
 * documents and `t`. A seek gives the same frame as a play, on the worker and on the main thread. The steps save a
 * checkpoint of the system memory each second. A seek back restores the last checkpoint before its time and runs the
 * steps from there.
 */
import type { FrameState } from "@scenity/scene/sequence";
import type { PresenterOutputs } from "../systems/outputs";
import type { RunnerMemory, SystemRunner } from "../systems/runner";

/** The steps of the systems in one second. */
export const SYSTEM_STEPS_PER_SECOND = 60;
/** The steps between two checkpoints of the system memory (one second). */
const CHECKPOINT_STEPS = SYSTEM_STEPS_PER_SECOND;

/** The time of step `k` in whole ms. */
export function stepTime(k: number): number {
  return Math.round((k * 1000) / SYSTEM_STEPS_PER_SECOND);
}

/** The last step at or before the time `t` (ms). */
export function lastStep(t: number): number {
  let k = Math.max(0, Math.floor((t * SYSTEM_STEPS_PER_SECOND) / 1000));
  while (stepTime(k + 1) <= t) k += 1;
  while (k > 0 && stepTime(k) > t) k -= 1;
  return k;
}

export class SystemSteps<I> {
  readonly #runner: SystemRunner<I>;
  /** The last step that ran, or -1 before the first step. */
  #step = -1;
  #out: PresenterOutputs | null = null;
  /** The memory before step `k`, for each `k` that is a whole count of checkpoint steps. */
  readonly #checkpoints = new Map<number, RunnerMemory>();

  constructor(runner: SystemRunner<I>) {
    this.#runner = runner;
  }

  /**
   * The presenter outputs of the last step at or before `t`. The steps from the last step to it run first. Each step
   * gets the frame state of its own time (`frameAt`) and the input of that frame (`inputOf`).
   */
  at(t: number, frameAt: (t: number) => FrameState, inputOf: (frame: FrameState) => I): PresenterOutputs | null {
    const target = lastStep(t);
    if (target < this.#step) this.#rewind(target);
    while (this.#step < target) {
      const k = this.#step + 1;
      if (k % CHECKPOINT_STEPS === 0 && k > 0 && !this.#checkpoints.has(k)) {
        this.#checkpoints.set(k, this.#runner.save());
      }
      const time = stepTime(k);
      const frame = frameAt(time);
      this.#out = this.#runner.step({ frame, input: inputOf(frame), t: time });
      this.#step = k;
    }
    return this.#out;
  }

  /**
   * Record an input event at the time `t`. The steps from the first step at or after `t` are stale: forget their
   * checkpoints, and return to a point before that step when the steps passed it. The next `at` runs them again with
   * the event.
   */
  forget(t: number): void {
    let first = lastStep(t);
    if (stepTime(first) < t) first += 1;
    for (const k of [...this.#checkpoints.keys()]) if (k > first) this.#checkpoints.delete(k);
    if (this.#step >= first) this.#rewind(first);
  }

  /** Return to the initial memory and forget the checkpoints (the documents changed). */
  reset(): void {
    this.#runner.reset();
    this.#checkpoints.clear();
    this.#step = -1;
    this.#out = null;
  }

  /** Restore the last checkpoint at or before step `target`, else the initial memory. */
  #rewind(target: number): void {
    let at = target - (target % CHECKPOINT_STEPS);
    while (at > 0 && !this.#checkpoints.has(at)) at -= CHECKPOINT_STEPS;
    const memory = at > 0 ? this.#checkpoints.get(at) : undefined;
    if (memory === undefined) {
      this.#runner.reset();
      this.#step = -1;
    } else {
      this.#runner.restore(memory);
      this.#step = at - 1;
    }
    this.#out = null;
  }
}
