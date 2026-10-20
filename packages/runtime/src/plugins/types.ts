// SPDX-License-Identifier: Apache-2.0
/**
 * The contracts of the runtime face of a plugin: the plugin and the input schema. The dev face of a plugin has its
 * debug layers and metrics: `defineDevPlugin({ id, layers, metrics, library })` of `@scenity/runtime-dev`. The runtime
 * face has no dev parts, so a player build holds no dev code.
 */
import type { ComponentDefinition } from "@scenity/scene/components";
import type { SimulationPlugin } from "@scenity/scene/sequence";
import type { Presenter } from "../scene/types";
import type { InputSchema } from "../protocol";
import type { SystemDefinition } from "../systems/types";
import type { InputMap } from "./inputMap";

export type { InputIssue, InputSchema } from "../protocol";

/**
 * A function that makes a new system. A runner gets its own system, so two runners do not share memory. `core` is the
 * scene core of the runner (`PluginRunnerOptions.core`). It is undefined for the ID checks of the plugin host.
 */
export type SystemFactory<I = unknown> = (core?: unknown) => SystemDefinition<I>;

/** A system of a plugin: a definition, or a factory of definitions for a system with memory. */
export type PluginSystem<I = unknown> = SystemDefinition<I> | SystemFactory<I>;

/** The runtime face of a plugin. Each ID of a part starts with the plugin ID and a dot. */
export interface RuntimePlugin<I = unknown> {
  /** The plugin ID: a lower case letter, then letters and digits (`doors`). */
  readonly id: string;
  readonly components: readonly ComponentDefinition[];
  readonly systems: readonly PluginSystem<I>[];
  /** The presenters by component ID. The key is the ID of the presenter. */
  readonly presenters: Readonly<Record<string, Presenter>>;
  /** The schema of the plugin input. With no schema, the input goes to the systems with no check. */
  readonly input?: InputSchema<I> | undefined;
  /**
   * The simulation face of the plugin (`defineSimulation` of `@scenity/scene/sequence`), or undefined. Its ID is the
   * plugin ID. The evaluator replays the action keys of the plugin, and `project` gives the plugin input. The document
   * core runs it in its time line, so the systems of the plugin get that input (core/documentPlugins.ts).
   */
  readonly simulation?: SimulationPlugin | undefined;
  /**
   * The input actions of the play mode (`defineInputMap`, inputMap.ts), or undefined. The systems read the
   * input events of each step as `ctx.inputs`.
   */
  readonly inputMap?: InputMap | undefined;
}

/** The input of `defineRuntimePlugin`: each part except the ID is optional. */
export interface RuntimePluginSpec<I = unknown> {
  readonly id: string;
  readonly components?: readonly ComponentDefinition[];
  readonly systems?: readonly PluginSystem<I>[];
  readonly presenters?: Readonly<Record<string, Presenter>>;
  readonly input?: InputSchema<I> | undefined;
  readonly simulation?: SimulationPlugin | undefined;
  readonly inputMap?: InputMap | undefined;
}
