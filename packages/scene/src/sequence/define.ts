// SPDX-License-Identifier: Apache-2.0
/**
 * `defineSimulation`: the simulation face of a plugin. A simulation gives the
 * meaning of the `action` keys whose action name starts with its ID and a dot. It has five parts:
 *
 * - `stateSchema`: the schema of the state (a zod schema has this shape, so a plugin can give its zod schema);
 * - `initial(params)`: the state at t = 0 from the `initial` value of the sequence for this plugin;
 * - `reduce(state, key)`: the state after one action key;
 * - `settle(state, t)`: the state at the time `t` with no key (the rules that run on the clock);
 * - `project(state, t)`: the plugin input of the runtime at `t`.
 *
 * The evaluator (`createEvaluator`) and the replay with the checkpoint memo (`SimulationReplay`) use the result as a
 * `SimulationPlugin`. Each function must be pure: it must not change its input state, and it must not read wall time
 * or `Math.random`.
 */
import type { JsonValue } from "../json";
import { PLUGIN_ID_PATTERN } from "../schema/sequence";
import type { SimulationAction, SimulationPlugin } from "./simulation";

/** One problem of a state: the path in the state and the message. */
export interface StateIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/**
 * The schema of a simulation state. The engine does not import zod into a plugin: any object with `safeParse` works.
 */
export interface StateSchema<S> {
  safeParse(
    value: unknown,
  ):
    | { readonly success: true; readonly data: S }
    | { readonly success: false; readonly error: { readonly issues: readonly StateIssue[] } };
}

/** The input of `defineSimulation`. `P` is the type of the plugin input that `project` gives. */
export interface SimulationSpec<S, P = unknown> {
  /** The plugin ID: the part of each action name before the first dot (`doors` for `doors.open`). */
  readonly id: string;
  readonly stateSchema: StateSchema<S>;
  initial(params: JsonValue | undefined): S;
  reduce(state: S, key: SimulationAction): S;
  settle(state: S, t: number): S;
  project(state: S, t: number): P;
}

/** A simulation: a `SimulationPlugin` with its state schema and a `project` function. */
export interface Simulation<S, P = unknown> extends SimulationPlugin<S> {
  readonly stateSchema: StateSchema<S>;
  project(state: S, t: number): P;
}

/** Make the simulation face of a plugin. A bad ID or a missing function throws. */
export function defineSimulation<S, P = unknown>(spec: SimulationSpec<S, P>): Simulation<S, P> {
  if (!PLUGIN_ID_PATTERN.test(spec.id)) throw new Error(`"${spec.id}" is not a simulation plugin ID`);
  for (const part of ["initial", "reduce", "settle", "project"] as const) {
    if (typeof spec[part] !== "function") throw new Error(`the simulation "${spec.id}" has no ${part} function`);
  }
  if (typeof spec.stateSchema.safeParse !== "function") {
    throw new Error(`the simulation "${spec.id}" has no state schema`);
  }
  return {
    id: spec.id,
    stateSchema: spec.stateSchema,
    initial: (params) => spec.initial(params),
    reduce: (state, key) => spec.reduce(state, key),
    settle: (state, t) => spec.settle(state, t),
    project: (state, t) => spec.project(state, t),
  };
}

/** The problems of a state against the state schema of its simulation, as `<JSON Pointer>: <message>` lines. */
export function stateProblems<S>(simulation: Pick<Simulation<S>, "stateSchema">, state: unknown): string[] {
  const parsed = simulation.stateSchema.safeParse(state);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => {
    const pointer = issue.path.map((part) => `/${String(part).replace(/~/g, "~0").replace(/\//g, "~1")}`).join("");
    return `${pointer === "" ? "/" : pointer}: ${issue.message}`;
  });
}
