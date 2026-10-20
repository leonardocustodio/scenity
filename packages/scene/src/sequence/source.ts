// SPDX-License-Identifier: Apache-2.0
/**
 * The external sources of a simulation state. A source gives the state of one simulation
 * plugin at a time, in place of a sequence and a `SimulationPlugin`. There are two kinds:
 *
 * - a recorded source (`recordedSource`, stream.ts): the samples of a recorded state stream. It can seek to each time
 *   in 0..duration, and a seek gives the state of playback;
 * - a live source (`liveSource`): an engine pushes its states. It keeps the states of a short buffer, so it can seek
 *   only in that buffer.
 *
 * `inputAt(t)` gives the plugin input of the runtime: the `project` output of the state, or the state itself. The
 * evaluator (`createEvaluator` with `sources`) and a player read the same interface.
 */

/** A source of the state of one simulation plugin. */
export interface SimulationSource<S = unknown, P = S> {
  /** The ID of the simulation plugin: the frame state keeps the state and the input under this ID. */
  readonly id: string;
  readonly kind: "recorded" | "live";
  /** The length of the time line of a recorded source in ms. Undefined for a live source. */
  readonly duration: number | undefined;
  /** The state at `t` in ms, or undefined when the source has no state for that time. */
  stateAt(t: number): S | undefined;
  /** The plugin input of the runtime at `t`, or undefined when the source has no state for that time. */
  inputAt(t: number): P | undefined;
}

/** The options of a source: its plugin ID and the function that makes the plugin input from a state. */
export interface SourceOptions<S, P> {
  readonly id: string;
  project?(state: S, t: number): P;
}

/** A live source: an engine pushes its states in time order. */
export interface LiveSource<S = unknown, P = S> extends SimulationSource<S, P> {
  readonly kind: "live";
  /** Add the state of the engine at `t`. A time before the last time is an error. */
  push(t: number, state: S): void;
  /** The last state and its time, or undefined before the first push. */
  latest(): { readonly t: number; readonly state: S } | undefined;
  /** Call `listener` after each push. The result removes the listener. */
  subscribe(listener: (t: number, state: S) => void): () => void;
}

export interface LiveSourceOptions<S, P> extends SourceOptions<S, P> {
  /** The time in ms that the buffer keeps before the last state (default 0: the last state only). */
  readonly bufferMs?: number;
}

/** The input of a state: the `project` output, or the state itself when the source has no `project`. */
export function inputOf<S, P>(options: SourceOptions<S, P>, state: S | undefined, t: number): P | undefined {
  if (state === undefined) return undefined;
  return options.project === undefined ? (state as unknown as P) : options.project(state, t);
}

function checkTime(t: number): void {
  if (!Number.isFinite(t)) throw new RangeError(`a source time is a finite number of ms, not ${String(t)}`);
}

/**
 * Make a live source. `stateAt(t)` gives the last state at or before `t` in the buffer. Before the first state of the
 * buffer, it gives undefined. A live time can have a fraction of a ms (the clock of the engine).
 */
export function liveSource<S, P = S>(options: LiveSourceOptions<S, P>): LiveSource<S, P> {
  const bufferMs = options.bufferMs ?? 0;
  if (!(bufferMs >= 0)) throw new RangeError("bufferMs is 0 or more");
  const samples: { t: number; state: S }[] = [];
  const listeners = new Set<(t: number, state: S) => void>();
  const stateAt = (t: number): S | undefined => {
    checkTime(t);
    for (let index = samples.length - 1; index >= 0; index -= 1) {
      const sample = samples[index];
      if (sample !== undefined && sample.t <= t) return sample.state;
    }
    return undefined;
  };
  return {
    id: options.id,
    kind: "live",
    duration: undefined,
    stateAt,
    inputAt: (t) => inputOf(options, stateAt(t), t),
    push(t, state) {
      checkTime(t);
      const last = samples.at(-1);
      if (last !== undefined && t < last.t)
        throw new RangeError(`a live state at ${String(t)} is before ${String(last.t)}`);
      samples.push({ t, state });
      // The buffer keeps the last state at or before its start, so a seek to the start has a state.
      while (samples.length > 1 && (samples[1]?.t ?? t) <= t - bufferMs) samples.shift();
      for (const listener of [...listeners]) listener(t, state);
    },
    latest: () => samples.at(-1),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
