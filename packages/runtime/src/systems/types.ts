// SPDX-License-Identifier: Apache-2.0
/**
 * The contracts of the systems: the context of one update, the definition of a system and the plain JSON of the
 * system memory.
 */
import type { StepInputs } from "@scenity/scene/input";
import type { FrameState } from "@scenity/scene/sequence";
import type { PresenterOutputs } from "./outputs";
import type { RandomStream } from "./random";

/** A plain JSON value. The system memory and the presenter values are JSON, so a checkpoint can go to a file. */
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

/** The context of one update of one system. */
export interface SystemContext<I = unknown> {
  /** The evaluated frame state of `@scenity/scene` (documents, layers, tracks, simulations). Read only. */
  readonly frame: FrameState;
  /** The plugin input (a live engine, a recorded stream). Read only. */
  readonly input: I;
  /** The simulation time in ms. */
  readonly t: number;
  /** The time in ms since the last step. It is 0 at the first step after a reset or a restore at no time. */
  readonly dt: number;
  /** The named random stream of the system. Each system has its own streams. */
  random(name: string): RandomStream;
  /** The presenter outputs of the frame: transforms, visibility, pose and material values. */
  readonly out: PresenterOutputs;
  /**
   * The input events of the play mode in this step (the actions of the input maps of the plugins). A document core
   * gives them. A plain `SystemRunner` gives none (undefined). An event applies at the first step at or after its
   * time, so a seek and a replay give the frames of the live session.
   */
  readonly inputs?: StepInputs;
}

/**
 * A system: one update for each frame. A system with memory must give `save` and `restore`, so a seek gives the frame
 * of a play. The memory is a plain JSON value. A system must not read the wall
 * clock, use `Math.random` or depend on the insertion order of a `Set` or a `Map` (the determinism lint).
 */
export interface SystemDefinition<I = unknown, M = unknown> {
  /** The system ID: a plugin ID, a dot and a name (`doors.swing`). */
  readonly id: string;
  /** The run order: a lower order runs first. Systems with the same order run in the order of their IDs. */
  readonly order: number;
  /** The component IDs that the system reads. The plugin host checks that the registry knows them. */
  readonly reads: readonly string[];
  update(ctx: SystemContext<I>): void;
  /** The memory of the system as plain JSON. The result must not share objects with the live memory. */
  save?(): M;
  /** Set the memory from a value of `save`. */
  restore?(memory: M): void;
}

/** The input of `defineSystem`: `reads` is optional. */
export type SystemSpec<I = unknown, M = unknown> = Omit<SystemDefinition<I, M>, "reads"> & {
  readonly reads?: readonly string[];
};
