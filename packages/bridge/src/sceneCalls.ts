// SPDX-License-Identifier: Apache-2.0
/**
 * The scene calls of the editor: the calls of the generic Claude tools `scene_query`,
 * `scene_commands` and `scene_command`. The scene page and the lab page serve them; the workbench host sends them
 * with `callTyped`.
 *
 * - `scene.query` (args `[query]`): the entities of the open scene that match a filter, with their transforms, bounds
 *   and component values (`queryScene` of `@scenity/editor-core` gives the result).
 * - `commands`: the command registry of the page with the argument schema of each command and what can run now.
 * - `proposalMode`: the switch of the session ("propose" or "apply").
 * - `scene.pick` (args `[x, y, options?]`): the entity under a point of the canvas, with the nearest sub-target
 *   (`entity:<id>#<sub>`) when the options ask for one.
 *
 * The call `command` (editorCalls.ts) runs one command; `{ by: "claude" }` makes the run follow the proposal rule.
 */
import { argError, defineBridgeCall, noArgs } from "./define";
import { isObject } from "./envelope";

/** The query of `scene.query` on the wire. */
export interface SceneQueryArgs {
  readonly where?: string;
  readonly ids?: readonly string[];
  readonly name?: string;
  readonly tag?: string;
  readonly component?: string;
  readonly under?: string;
  readonly values?: boolean | readonly string[];
  readonly limit?: number;
}

/** A transform of the answer of `scene.query`: a place, a turn (a quaternion) and a scale. */
export interface SceneQueryTransform {
  readonly position: readonly number[];
  readonly rotation: readonly number[];
  readonly scale: readonly number[];
}

/** One entity of the answer of `scene.query`. */
export interface SceneQueryEntity {
  readonly id: string;
  readonly name: string | null;
  readonly parent: string | null;
  readonly tags: readonly string[];
  readonly components: readonly string[];
  readonly local: SceneQueryTransform | null;
  readonly world: SceneQueryTransform | null;
  readonly bounds: { readonly min: readonly number[]; readonly max: readonly number[] } | null;
  readonly values?: Readonly<Record<string, unknown>>;
}

/** The answer of `scene.query`. */
export interface SceneQueryAnswer {
  readonly matches: number;
  readonly total: number;
  readonly entities: readonly SceneQueryEntity[];
}

const TEXT_FIELDS = ["where", "name", "tag", "component", "under"] as const;

/** True for a list of texts. */
function texts(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Check the arguments of `scene.query`: one query object (absent: an empty query). Unknown fields are refused. */
export function sceneQueryArgsOf(raw: readonly unknown[]): [SceneQueryArgs] {
  const [query] = raw;
  if (query === undefined || query === null) return [{}];
  if (!isObject(query)) argError("scene.query", "the query must be an object.");
  const known = new Set<string>([...TEXT_FIELDS, "ids", "values", "limit"]);
  const extra = Object.keys(query).filter((key) => !known.has(key));
  if (extra.length > 0) argError("scene.query", `no field "${extra.join('", "')}".`);
  for (const field of TEXT_FIELDS) {
    if (query[field] !== undefined && typeof query[field] !== "string") argError("scene.query", `${field} is a text.`);
  }
  if (query.ids !== undefined && !texts(query.ids)) argError("scene.query", "ids is a list of texts.");
  const { values, limit } = query;
  if (values !== undefined && typeof values !== "boolean" && !texts(values)) {
    argError("scene.query", "values is true, false or a list of component IDs.");
  }
  if (limit !== undefined && !(typeof limit === "number" && Number.isInteger(limit) && limit >= 1 && limit <= 500)) {
    argError("scene.query", "limit is a whole number from 1 to 500.");
  }
  return [query];
}

/** Read the answer of `scene.query`. */
export function readSceneQuery(raw: unknown): SceneQueryAnswer {
  if (!isObject(raw) || !Array.isArray(raw.entities) || typeof raw.matches !== "number") {
    throw new Error("scene.query: the page gave no query result.");
  }
  return raw as unknown as SceneQueryAnswer;
}

/** One command of the answer of `commands`, as the command registry lists it. */
export interface CommandInfo {
  readonly id: string;
  readonly title: string;
  readonly key: string | null;
  readonly kind: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly selection: string;
  readonly owner: boolean;
  readonly available: boolean;
  readonly reason: string | null;
  /** The metadata of the command (a page of an older editor gives none). */
  readonly description?: string;
  readonly category?: string;
  readonly keys?: readonly string[];
  readonly undo?: string;
  readonly schema?: Readonly<Record<string, unknown>>;
  /** The origin of the command in the editor window ("page", "scene" or "sequence"). */
  readonly source?: string;
}

/** Read the answer of `commands`: the entries with a text ID in their order. A bad list is an error. */
export function readCommands(raw: unknown): CommandInfo[] {
  if (!Array.isArray(raw)) throw new Error("commands: the page gave no command list.");
  return raw.filter((item): item is CommandInfo => isObject(item) && typeof item.id === "string");
}

/** Read the answer of `proposalMode`: "apply", else "propose". */
export function readProposalSwitch(raw: unknown): "propose" | "apply" {
  return raw === "apply" ? "apply" : "propose";
}

/** The scene call `scene.query`. */
export const SCENE_QUERY_CALL = defineBridgeCall({
  name: "scene.query",
  args: sceneQueryArgsOf,
  result: readSceneQuery,
});
/** The editor call `commands`. */
export const COMMANDS_CALL = defineBridgeCall({ name: "commands", args: noArgs, result: readCommands });
/** The editor call `proposalMode`. */
export const PROPOSAL_MODE_CALL = defineBridgeCall({ name: "proposalMode", args: noArgs, result: readProposalSwitch });

/** The options of `scene.pick`: the sub-targets to name (true: each kind) and the pick layers. */
export interface ScenePickOptions {
  readonly sub?: boolean | readonly string[];
  readonly layers?: readonly string[];
}

/** One hit of `scene.pick`: the entity, the component, the sub-target, the world point and the distance. */
export interface ScenePickHit {
  readonly entity: string;
  readonly component: string | null;
  readonly sub?: string;
  readonly point: readonly number[];
  readonly distance: number;
}

/** Check the arguments of `scene.pick`: a point of the canvas (CSS pixels) and the options. */
export function scenePickArgsOf(raw: readonly unknown[]): [x: number, y: number, options: ScenePickOptions] {
  const [x, y, options] = raw;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
    argError("scene.pick", "the point must be two numbers (CSS pixels of the canvas).");
  }
  if (options === undefined || options === null) return [x, y, {}];
  if (!isObject(options)) argError("scene.pick", "the options must be an object.");
  const { sub, layers } = options;
  if (sub !== undefined && typeof sub !== "boolean" && !texts(sub)) {
    argError("scene.pick", "sub is true, false or a list of kinds (socket, bone, pathPoint).");
  }
  if (layers !== undefined && !texts(layers)) argError("scene.pick", "layers is a list of texts.");
  return [x, y, options];
}

/** Read the answer of `scene.pick`: a hit, or null when the point hits no entity. */
export function readScenePick(raw: unknown): ScenePickHit | null {
  if (raw === null || raw === undefined) return null;
  if (!isObject(raw) || typeof raw.entity !== "string" || !Array.isArray(raw.point)) {
    throw new Error("scene.pick: the page gave no hit.");
  }
  return raw as unknown as ScenePickHit;
}

/** The scene call `scene.pick`. */
export const SCENE_PICK_CALL = defineBridgeCall({ name: "scene.pick", args: scenePickArgsOf, result: readScenePick });
