// SPDX-License-Identifier: Apache-2.0
/**
 * The ops of the layout search: the chosen op paths, their groups and start values, and the scene ops (`set` ops) of
 * a candidate.
 *
 * - A search op names a number of the scene by a JSON Pointer (`/entities/lamp/components/transform/position/0`).
 *   The kind `yaw` names a rotation quaternion: the value is a turn about Y in radians.
 * - The ops of a group move together. The default group of an op is the entity of its path.
 * - A written value snaps to the grid of its op. A value within half of the grid from the start keeps the start, so
 *   a part that does not move gives no op.
 */
import { roundNumber } from "@scenity/scene/canonical";
import { getAt, parsePointer } from "@scenity/scene";
import type { SetOp } from "@scenity/scene/schema/entity";

export type SearchOpKind = "number" | "yaw";

/** One chosen op path of a search. */
export interface SearchOp {
  /** A JSON Pointer of a number of the scene, or of a rotation quaternion for the kind `yaw`. */
  readonly path: string;
  /** The least and the largest change from the start value. */
  readonly min: number;
  readonly max: number;
  /** The grid of a proposed value. */
  readonly step: number;
  /** The step of the refine on this op. Without it, the refine does not change the op. */
  readonly nudge?: number;
  /** `number` (default) or `yaw`: a turn about Y (radians), written as a quaternion. */
  readonly kind?: SearchOpKind;
  /** The group of the op: the ops of a group move together. Default: the entity of the path. */
  readonly group?: string;
  /** The weight of a change in the distance of two layouts (default 1). */
  readonly weight?: number;
  /** The grid of the written value (default: the number grid of the documents, 1e-6). */
  readonly grid?: number;
}

/** A group of ops with the start value of each op. */
export interface SearchGroup {
  readonly id: string;
  readonly ops: readonly SearchOp[];
  readonly start: readonly number[];
}

/** A value that a candidate writes: an op of a moved group, or a value that follows a moved group. */
export interface SearchWrite {
  readonly path: string;
  readonly kind: SearchOpKind;
  readonly start: number;
  /** The value before the grid. */
  readonly value: number;
  readonly grid?: number;
}

/** A value on a grid. A grid with a whole inverse (0.01, 1e-4) divides by the inverse, so 0.29 stays 0.29. */
export function onGrid(value: number, step: number): number {
  const inverse = 1 / step;
  const whole = Math.round(inverse);
  if (Math.abs(inverse - whole) < 1e-9) return Math.round(value * whole) / whole;
  return Math.round(value / step) * step;
}

/** The yaw of a turn about Y: the angle on the number grid of the documents (1e-6). */
export function yawOfQuat(rotation: readonly number[] | undefined): number {
  return rotation === undefined ? 0 : roundNumber(2 * Math.atan2(rotation[1] ?? 0, rotation[3] ?? 1));
}

/**
 * The quaternion of a turn about Y, with each part on the number grid of the documents. The function tries the grid
 * points near the exact parts, so that `yawOfQuat` gives the yaw on the grid again.
 */
export function quatOfYaw(yaw: number): [number, number, number, number] {
  const want = roundNumber(yaw);
  const sin = roundNumber(Math.sin(want / 2));
  const cos = roundNumber(Math.cos(want / 2));
  let best: [number, number, number, number] = [0, sin, 0, cos];
  let error = Math.abs(2 * Math.atan2(sin, cos) - want);
  for (let i = -6; i <= 6 && yawOfQuat(best) !== want; i += 1) {
    for (let j = -6; j <= 6; j += 1) {
      const y = roundNumber(sin + i * 1e-6);
      const w = roundNumber(cos + j * 1e-6);
      const next = Math.abs(2 * Math.atan2(y, w) - want);
      if (next < error) [best, error] = [[0, y, 0, w], next];
    }
  }
  return best;
}

/** The value of an op path in a scene: a number, or the yaw of a quaternion (no rotation is the yaw 0). */
export function valueAt(scene: unknown, path: string, kind: SearchOpKind = "number"): number {
  const tokens = parsePointer(path);
  if (tokens === undefined) throw new Error(`"${path}" is not a JSON Pointer`);
  const value = getAt(scene, tokens);
  if (kind === "yaw") {
    if (value === undefined) return 0;
    if (Array.isArray(value) && value.length === 4 && value.every((part) => typeof part === "number")) {
      return yawOfQuat(value);
    }
    throw new Error(`${path} is not a rotation quaternion`);
  }
  if (typeof value !== "number") throw new Error(`${path} is not a number of the scene`);
  return value;
}

/** The entity of a path `/entities/<id>/…`, else the path. */
function entityOf(path: string): string {
  const tokens = parsePointer(path) ?? [];
  return tokens[0] === "entities" && tokens[1] !== undefined ? tokens[1] : path;
}

/** The groups of the ops, in the order of their first op, with the start values from the scene. */
export function searchGroups(scene: unknown, ops: readonly SearchOp[]): SearchGroup[] {
  const groups = new Map<string, { ops: SearchOp[]; start: number[] }>();
  for (const op of ops) {
    if (!(op.step > 0) || op.min > op.max) throw new Error(`${op.path}: a search op needs a step > 0 and min ≤ max`);
    const id = op.group ?? entityOf(op.path);
    const group = groups.get(id) ?? { ops: [], start: [] };
    group.ops.push(op);
    group.start.push(valueAt(scene, op.path, op.kind));
    groups.set(id, group);
  }
  return [...groups].map(([id, group]) => ({ id, ops: group.ops, start: group.start }));
}

/** The writes of the ops of a group at its values. */
export function groupWrites(group: SearchGroup, values: readonly number[]): SearchWrite[] {
  return group.ops.map((op, index) => ({
    path: op.path,
    kind: op.kind ?? "number",
    start: group.start[index] ?? 0,
    value: values[index] ?? 0,
    ...(op.grid === undefined ? {} : { grid: op.grid }),
  }));
}

/** The written value of a write: the start when it is within half of the grid, else the value on the grid. */
export function written(write: SearchWrite): number {
  const grid = write.grid ?? 1e-6;
  return Math.abs(write.value - write.start) < grid / 2 ? write.start : roundNumber(onGrid(write.value, grid));
}

/** The `set` ops of writes: one op for each written value that is not the start, in the order of the paths. */
export function writeOps(writes: readonly SearchWrite[]): SetOp[] {
  const ops = new Map<string, SetOp>();
  for (const write of writes) {
    const value = written(write);
    if (value === write.start) ops.delete(write.path);
    else ops.set(write.path, { op: "set", path: write.path, value: write.kind === "yaw" ? quatOfYaw(value) : value });
  }
  return [...ops.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
