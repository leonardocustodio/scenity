// SPDX-License-Identifier: Apache-2.0
/**
 * The systems of the plugins: the light part of the plugin host. It makes the runner of the plugin systems. It has no
 * check, no component registry and no presenter. Thus a plugin core in a render worker can use it with no zod and no
 * scene builder (the size budget of the worker). `PluginHost` (host.ts) adds the checks of the IDs, the registries and
 * the input checks. A test of the plugin runs them.
 */
import { SystemRunner, type SystemRunnerOptions } from "../systems/runner";
import type { SystemContext, SystemDefinition } from "../systems/types";
import type { PluginSystem, RuntimePlugin } from "./types";

/** The plugin input of all the plugins, by plugin ID. */
export type PluginInputs = Readonly<Record<string, unknown>>;

/** The options of the runner of the plugin systems. */
export interface PluginRunnerOptions extends SystemRunnerOptions {
  /**
   * The scene core that runs the systems. Each system factory gets it. A coarse system of a plugin core
   * controls its core through it. Default: undefined.
   */
  readonly core?: unknown;
}

/** The system of a source: a definition, or a new definition of a factory for the core. */
export function systemOf(source: PluginSystem, core?: unknown): SystemDefinition {
  return typeof source === "function" ? source(core) : source;
}

/** A system that gets the input of its plugin as `ctx.input`. The memory functions go to the system of the plugin. */
function scopedSystem(pluginId: string, system: SystemDefinition): SystemDefinition<PluginInputs> {
  const scoped: SystemDefinition<PluginInputs> = {
    id: system.id,
    order: system.order,
    reads: system.reads,
    update(ctx: SystemContext<PluginInputs>) {
      const input = Object.hasOwn(ctx.input, pluginId) ? ctx.input[pluginId] : undefined;
      system.update({ ...ctx, input });
    },
  };
  if (system.save === undefined || system.restore === undefined) return scoped;
  return { ...scoped, save: system.save.bind(system), restore: system.restore.bind(system) };
}

export class PluginSystems {
  readonly plugins: readonly RuntimePlugin[];

  /** The plugins as they are, with no check: `PluginHost` checks them (a test of each plugin). */
  constructor(plugins: readonly RuntimePlugin[]) {
    this.plugins = plugins;
  }

  /**
   * Make a system runner with the systems of all the plugins. Each system gets the input of its plugin as
   * `ctx.input`. A factory gives a new system to each runner. A plain definition is the same object in each runner.
   */
  createRunner(options: PluginRunnerOptions = {}): SystemRunner<PluginInputs> {
    const systems = this.plugins.flatMap((plugin) =>
      plugin.systems.map((source) => scopedSystem(plugin.id, systemOf(source, options.core))),
    );
    return new SystemRunner(systems, options);
  }
}
