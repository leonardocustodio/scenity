// SPDX-License-Identifier: Apache-2.0
/**
 * The system runner. It runs the systems each frame in a stable order. It saves and restores all the system memory
 * as plain JSON: the memory of each system, the random streams and the time of the last step. A seek restores a
 * checkpoint and runs the frames from there, so a seek gives the frame of a play.
 */
import type { FrameState } from "@scenity/scene/sequence";
import { PresenterOutputs } from "./outputs";
import { RandomStreams, type RandomStates } from "./random";
import type { Json, SystemContext, SystemDefinition } from "./types";

export interface SystemRunnerOptions {
  /** The document ID for the seeds of the random streams (the scene ID or the project ID). Default: `""`. */
  readonly documentId?: string;
  /** The seed of the random streams. Default: 0. */
  readonly seed?: number | string;
}

/** The input of one step. `t` is the simulation time in ms. The default is `frame.t`. */
export interface StepInput<I> {
  readonly frame: FrameState;
  readonly input: I;
  readonly t?: number;
}

/** All the system memory as plain JSON: a checkpoint. */
export interface RunnerMemory {
  /** The time of the last step, or null before the first step. */
  readonly t: number | null;
  /** The memory of each system that has `save`, by system ID. */
  readonly systems: Readonly<Record<string, Json>>;
  /** The state of each random stream, by `<system ID>/<stream name>`. */
  readonly random: RandomStates;
}

/** A deep copy of a JSON value. It also removes the parts that JSON cannot hold. */
function cloneJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** The systems in run order: the order, then the ID. The compare does not depend on the locale. */
export function sortSystems<S extends Pick<SystemDefinition, "id" | "order">>(systems: readonly S[]): S[] {
  return [...systems].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export class SystemRunner<I = unknown> {
  /** The systems in run order. */
  readonly systems: readonly SystemDefinition<I>[];
  readonly #random: RandomStreams;
  readonly #initial: RunnerMemory;
  #time: number | null = null;

  /** The constructor saves the memory of the systems as the initial memory. `reset` returns to it. */
  constructor(systems: readonly SystemDefinition<I>[], options: SystemRunnerOptions = {}) {
    const ids = new Set<string>();
    for (const system of systems) {
      if (ids.has(system.id)) throw new Error(`the system "${system.id}" is in the list two times`);
      ids.add(system.id);
    }
    this.systems = sortSystems(systems);
    this.#random = new RandomStreams(options.documentId ?? "", options.seed ?? 0);
    this.#initial = this.save();
  }

  /** The time of the last step in ms, or null before the first step. */
  get time(): number | null {
    return this.#time;
  }

  /**
   * Run each system one time and return the presenter outputs of the frame. The time must not decrease. For an
   * earlier time, restore a checkpoint (or reset) first.
   */
  step({ frame, input, t = frame.t }: StepInput<I>): PresenterOutputs {
    if (!Number.isFinite(t)) throw new RangeError(`a step time is a finite number of ms, not ${String(t)}`);
    if (this.#time !== null && t < this.#time) {
      throw new RangeError(`the step time ${String(t)} is before ${String(this.#time)}: restore a checkpoint first`);
    }
    const dt = this.#time === null ? 0 : t - this.#time;
    const out = new PresenterOutputs();
    for (const system of this.systems) {
      const prefix = `${system.id}/`;
      const ctx: SystemContext<I> = { frame, input, t, dt, out, random: (name) => this.#random.get(prefix + name) };
      system.update(ctx);
    }
    this.#time = t;
    return out;
  }

  /** All the system memory as plain JSON (a copy). */
  save(): RunnerMemory {
    const systems: Record<string, Json> = {};
    for (const system of this.systems) {
      if (system.save !== undefined) systems[system.id] = cloneJson(system.save() as Json);
    }
    return { t: this.#time, systems, random: this.#random.save() };
  }

  /**
   * Set all the system memory from a checkpoint of `save`. A system that the checkpoint does not hold gets its
   * initial memory. A random stream that the checkpoint does not hold starts again from its seed.
   */
  restore(memory: RunnerMemory): void {
    for (const system of this.systems) {
      if (system.restore === undefined) continue;
      const saved = Object.hasOwn(memory.systems, system.id)
        ? memory.systems[system.id]
        : this.#initial.systems[system.id];
      system.restore(cloneJson(saved));
    }
    this.#random.restore(memory.random);
    this.#time = memory.t;
  }

  /** Return to the initial memory (a seek to the start). */
  reset(): void {
    this.restore(this.#initial);
  }
}
