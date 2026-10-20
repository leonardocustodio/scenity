// SPDX-License-Identifier: Apache-2.0
/**
 * The plugin host. It takes the runtime faces of the plugins of a project and checks their IDs. It makes the merged
 * component registry, the merged presenter registry and the system runner. It also checks the plugin input with the
 * schema of each plugin. The runner is in the light part `PluginSystems` (systems.ts).
 */
import { builtinComponents, ComponentRegistry, type ComponentDefinition } from "@scenity/scene/components";
import { builtinPresenterList } from "../scene/presenters/index";
import { PresenterRegistry } from "../scene/registry";
import type { Presenter } from "../scene/types";
import { PLUGIN_ID_PATTERN } from "./define";
import { inputActions } from "./inputMap";
import { PluginSystems, systemOf, type PluginInputs } from "./systems";
import type { SystemDefinition } from "../systems/types";
import type { SimulationPlugin } from "@scenity/scene/sequence";
import type { RuntimePlugin } from "./types";

export interface PluginHostOptions {
  /** The components under the plugin components. Default: the built-in components of `@scenity/scene`. */
  readonly components?: readonly ComponentDefinition[];
  /** The presenters under the plugin presenters. Default: the built-in presenters of the scene builder. */
  readonly presenters?: readonly Presenter[];
}

/** One problem of the plugin input: the plugin ID, the JSON Pointer in its input and the message. */
export interface PluginInputProblem {
  readonly plugin: string;
  readonly path: string;
  readonly message: string;
}

export type PluginInputResult =
  | { readonly ok: true; readonly input: PluginInputs }
  | { readonly ok: false; readonly problems: readonly PluginInputProblem[] };

/** The error of a bad plugin list. `problems` lists each problem. */
export class PluginHostError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`the plugins have ${String(problems.length)} problem(s):\n- ${problems.join("\n- ")}`);
    this.name = "PluginHostError";
    this.problems = problems;
  }
}

/** The problems of the IDs of one plugin: each part ID starts with the plugin ID and a dot. */
function partProblems(plugin: RuntimePlugin, systems: readonly SystemDefinition[]): string[] {
  const problems: string[] = [];
  const prefix = `${plugin.id}.`;
  const parts: [string, readonly string[]][] = [
    ["component", plugin.components.map((component) => component.id)],
    ["presenter", Object.keys(plugin.presenters)],
    ["system", systems.map((system) => system.id)],
    // The input actions of a plugin start with its ID, as its action keys do.
    ["input action", plugin.inputMap === undefined ? [] : inputActions(plugin.inputMap)],
  ];
  for (const [kind, ids] of parts) {
    const seen = new Set<string>();
    for (const id of ids) {
      if (!id.startsWith(prefix)) problems.push(`${plugin.id}: the ${kind} ID "${id}" does not start with "${prefix}"`);
      if (seen.has(id)) problems.push(`${plugin.id}: the ${kind} ID "${id}" is in the plugin two times`);
      seen.add(id);
    }
  }
  for (const [key, presenter] of Object.entries(plugin.presenters)) {
    if (presenter.id !== key) problems.push(`${plugin.id}: the presenter of "${key}" has the ID "${presenter.id}"`);
  }
  // The simulation of a plugin reduces the action keys `<plugin ID>.*`, so it has the plugin ID.
  const simulation = plugin.simulation;
  if (simulation !== undefined && simulation.id !== plugin.id) {
    problems.push(`${plugin.id}: the simulation has the ID "${simulation.id}"`);
  }
  return problems;
}

/** The problems of the plugin IDs: the pattern, and an ID two times in the list. */
function pluginIdProblems(plugins: readonly RuntimePlugin[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const plugin of plugins) {
    if (!PLUGIN_ID_PATTERN.test(plugin.id)) problems.push(`"${plugin.id}" is not a plugin ID`);
    if (seen.has(plugin.id)) problems.push(`the plugin "${plugin.id}" is in the list two times`);
    seen.add(plugin.id);
  }
  return problems;
}

export class PluginHost extends PluginSystems {
  /** The built-in components and the plugin components, in the order of the plugin list. */
  readonly components: ComponentRegistry;
  /** The built-in presenters and the plugin presenters. Give it to the `SceneBuilder`. */
  readonly presenters: PresenterRegistry;
  /** The simulations of the plugins, in the order of the plugin list. Give them to `createEvaluator`. */
  readonly simulations: readonly SimulationPlugin[];

  /** Check the plugins and merge their parts. A problem throws a `PluginHostError` that lists all the problems. */
  constructor(plugins: readonly RuntimePlugin[], options: PluginHostOptions = {}) {
    const systems = plugins.map((plugin) => plugin.systems.map((source) => systemOf(source)));
    const idProblems = pluginIdProblems(plugins);
    plugins.forEach((plugin, index) => idProblems.push(...partProblems(plugin, systems[index] ?? [])));
    if (idProblems.length > 0) throw new PluginHostError(idProblems);
    super(plugins);
    // The registrations come only after the IDs pass.
    const problems: string[] = [];
    const components = new ComponentRegistry(options.components ?? builtinComponents);
    const presenters = new PresenterRegistry(options.presenters ?? builtinPresenterList);
    for (const plugin of plugins) {
      for (const component of plugin.components) register(problems, () => components.register(component));
      for (const presenter of Object.values(plugin.presenters)) {
        if (!components.has(presenter.id))
          problems.push(`${plugin.id}: no component "${presenter.id}" for a presenter`);
        register(problems, () => presenters.register(presenter));
      }
    }
    for (const system of systems.flat()) {
      for (const id of system.reads) {
        if (!components.has(id)) problems.push(`the system "${system.id}" reads the unknown component "${id}"`);
      }
    }
    if (problems.length > 0) throw new PluginHostError(problems);
    this.components = components;
    this.presenters = presenters;
    this.simulations = plugins.flatMap((plugin) => (plugin.simulation === undefined ? [] : [plugin.simulation]));
  }

  /**
   * Check the plugin input with the schema of each plugin. The result holds the parsed value of each plugin with a
   * schema, and the value as it is for a plugin with no schema. A key with no plugin is a problem.
   */
  parseInput(input: PluginInputs): PluginInputResult {
    const problems: PluginInputProblem[] = [];
    const out: Record<string, unknown> = {};
    const known = new Set(this.plugins.map((plugin) => plugin.id));
    for (const key of Object.keys(input).sort()) {
      if (!known.has(key)) problems.push({ plugin: key, path: "", message: `no plugin "${key}" is loaded` });
    }
    for (const plugin of this.plugins) {
      const value = Object.hasOwn(input, plugin.id) ? input[plugin.id] : undefined;
      if (plugin.input === undefined) {
        if (value !== undefined) out[plugin.id] = value;
        continue;
      }
      const parsed = plugin.input.safeParse(value);
      if (parsed.success) out[plugin.id] = parsed.data;
      else problems.push(...parsed.error.issues.map((issue) => inputProblem(plugin.id, issue)));
    }
    return problems.length === 0 ? { ok: true, input: out } : { ok: false, problems };
  }
}

/** Run one registration and keep its error as a problem. */
function register(problems: string[], action: () => unknown): void {
  try {
    action();
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
}

function inputProblem(plugin: string, issue: { readonly path: readonly PropertyKey[]; readonly message: string }) {
  const path = issue.path.map((part) => `/${String(part).replace(/~/g, "~0").replace(/\//g, "~1")}`).join("");
  return { plugin, path, message: issue.message };
}
