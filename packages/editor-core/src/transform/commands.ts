// SPDX-License-Identifier: Apache-2.0
/**
 * The transform commands of the editor: the command twins of the gizmo drags. A script, a key or Claude (the tool
 * `scene_command`) moves, turns and scales entities with them. Each command is one edit, and thus one step of the one
 * history. A locked entity does not change.
 *
 * - `entity.move`: a move to a world point (the axes that the command gives, and the other axes stay), or by a world
 *   vector with `relative: true`. With more than one entity, the first entity goes to the point and the others move
 *   by the same vector.
 * - `entity.turn`: a turn by degrees about a world axis through the origin of each entity.
 * - `entity.scale`: the local scale times a factor on one axis or on each axis.
 *
 * No Vue import.
 */
import { worldTransform } from "@scenity/scene/world";
import type { Vec3 } from "@scenity/scene/math";
import type { SceneOp } from "@scenity/scene/schema/entity";
import { CommandError, defineCommands, num, numberArg, textArg, type Args, type CommandHost } from "../command";
import { targetEntities, type HierarchyOp, type HierarchyState } from "../hierarchy/commands";
import { entityLabel } from "../hierarchy/tree";
import { isLocked } from "../hierarchy/view";
import type { SceneEditOp } from "../ops";
import { axisFactors, moveOps, scaleOps, transformTargets, turnOps, type AxisIndex } from "./transformOps";

const ENTITY_RULE = { kinds: ["entity"], orArg: "entity" } as const;

const ENTITY_ARG = {
  type: "string",
  description: "An entity ID, or entity IDs separated by commas (default: the selected entities).",
  optional: true,
} as const;

const AXIS_NAMES = ["x", "y", "z"] as const;

function sceneOps(ops: readonly SceneOp[]): SceneEditOp[] {
  return ops.map((op) => ({ kind: "scene", op }));
}

/** The entities that a transform command changes: the targets with a transform, without the locked ones. */
function movable(args: Args, state: HierarchyState): string[] {
  const ids = transformTargets(state.doc, targetEntities(args, state), (id) => isLocked(state.doc, state.view, id));
  if (ids.length === 0) throw new CommandError("No target entity has a transform that can change (or it is locked).");
  return ids;
}

/** The words of a list of entities in a title. */
function names(state: HierarchyState, ids: readonly string[]): string {
  return ids.length === 1 ? entityLabel(state.doc, ids[0] ?? "") : `${String(ids.length)} entities`;
}

/** The axis index of an axis argument ("x", "y" or "z"). */
function axisOf(args: Args, fallback: AxisIndex | null): AxisIndex | null {
  const index = AXIS_NAMES.indexOf(textArg(args, "axis") as (typeof AXIS_NAMES)[number]);
  return index < 0 ? fallback : (index as AxisIndex);
}

/** The world vector of a move: to the point of the given axes, or by the given vector with `relative`. */
function moveDelta(args: Args, state: HierarchyState, first: string): Vec3 {
  const given = AXIS_NAMES.map((name) => numberArg(args, name));
  if (given.every((value) => value === undefined)) throw new CommandError("Give x, y or z.");
  if (args.relative === true) return [given[0] ?? 0, given[1] ?? 0, given[2] ?? 0];
  const at = worldTransform(state.doc, first)?.position ?? [0, 0, 0];
  return [(given[0] ?? at[0]) - at[0], (given[1] ?? at[1]) - at[1], (given[2] ?? at[2]) - at[2]];
}

/** The words of the given axes of a move, for example "x 0.5, z -1". */
function axisWords(args: Args): string {
  return AXIS_NAMES.flatMap((name) => {
    const value = numberArg(args, name);
    return value === undefined ? [] : [`${name} ${num(value)}`];
  }).join(", ");
}

/** The transform commands of the editor. */
export const TRANSFORM_COMMANDS = defineCommands<HierarchyState, CommandHost, HierarchyOp>([
  {
    id: "entity.move",
    icon: "move-3d",
    title: "Move the entities to a world point (or by a vector)",
    key: null,
    kind: "edit",
    args: {
      entity: ENTITY_ARG,
      x: { type: "number", description: "The world x in metres (default: no change).", optional: true },
      y: { type: "number", description: "The world y in metres (default: no change).", optional: true },
      z: { type: "number", description: "The world z in metres (default: no change).", optional: true },
      relative: {
        type: "boolean",
        description: "True: move by x, y and z; false: move to the point (default).",
        optional: true,
      },
    },
    selection: ENTITY_RULE,
    build: (args, state) => {
      const ids = movable(args, state);
      const delta = moveDelta(args, state, ids[0] ?? "");
      const how = args.relative === true ? "by" : "to";
      const ops = moveOps(state.doc, ids, delta);
      return { kind: "edit", title: `Move ${names(state, ids)} ${how} ${axisWords(args)}`, ops: sceneOps(ops) };
    },
  },
  {
    id: "entity.turn",
    icon: "rotate-3d",
    title: "Turn the entities about a world axis",
    key: null,
    kind: "edit",
    args: {
      entity: ENTITY_ARG,
      degrees: { type: "number", description: "The angle in degrees (positive: counterclockwise from the axis)." },
      axis: { type: "string", description: "The world axis.", values: AXIS_NAMES, default: "y" },
    },
    selection: ENTITY_RULE,
    build: (args, state) => {
      const ids = movable(args, state);
      const axis = axisOf(args, 1) ?? 1;
      const unit: Vec3 = [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0];
      const degrees = numberArg(args, "degrees") ?? 0;
      const ops = turnOps(state.doc, ids, unit, (degrees * Math.PI) / 180, null);
      const title = `Turn ${names(state, ids)} ${num(degrees)}° about ${AXIS_NAMES[axis]}`;
      return { kind: "edit", title, ops: sceneOps(ops) };
    },
  },
  {
    id: "entity.scale",
    icon: "scale-3d",
    title: "Scale the entities on one axis or on each axis",
    key: null,
    kind: "edit",
    args: {
      entity: ENTITY_ARG,
      factor: { type: "number", description: "The factor of the local scale (1 keeps it).", min: 0.001, max: 1000 },
      axis: {
        type: "string",
        description: "The local axis (default: each axis, a uniform scale).",
        values: AXIS_NAMES,
        optional: true,
      },
    },
    selection: ENTITY_RULE,
    build: (args, state) => {
      const ids = movable(args, state);
      const axis = axisOf(args, null);
      const factor = numberArg(args, "factor") ?? 1;
      const ops = scaleOps(state.doc, ids, axisFactors(axis, factor), null);
      const on = axis === null ? "" : ` on ${AXIS_NAMES[axis]}`;
      return { kind: "edit", title: `Scale ${names(state, ids)} by ${num(factor)}${on}`, ops: sceneOps(ops) };
    },
  },
]);
