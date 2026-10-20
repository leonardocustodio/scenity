// SPDX-License-Identifier: Apache-2.0
/**
 * The transform ops of the gizmos: a move, a turn and a scale of the selected entities as scene ops on `transform`. A
 * move and a turn are in the world (an axis of the world or of the primary entity). The ops write the local values
 * through the parent of each entity. The pivot is the origin of each entity ("pivot") or the centre of the origins of
 * the selection ("centre"). A scale changes the local scale of each entity on its own axes. With the centre pivot, the
 * origins also move away from the centre.
 *
 * Each function starts from the document at the start of the drag. Thus a live drag gives the same ops for the same
 * pointer at each move. Pure functions, no DOM.
 */
import { roundNumber } from "@scenity/scene/canonical";
import { qconjugate, qfromAxisAngle, qmul, qnormalize, qrotate, vadd, vdot, vscale, vsub } from "@scenity/scene/math";
import type { Quat, Vec3 } from "@scenity/scene/math";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import { localTransform, worldTransform, type WorldTransform } from "@scenity/scene/world";

/** The axes of a gizmo: the world axes, or the axes of the primary entity. */
export type TransformSpace = "world" | "local";
/** The point of a turn or a scale: the origin of each entity, or the centre of the selection. */
export type TransformPivot = "pivot" | "centre";
/** An axis index: 0 is x, 1 is y, 2 is z. */
export type AxisIndex = 0 | 1 | 2;

/** The place of a gizmo: its origin and its three unit axes in the world. */
export interface GizmoFrame {
  readonly origin: Vec3;
  readonly axes: readonly [Vec3, Vec3, Vec3];
}

const WORLD_AXES: readonly [Vec3, Vec3, Vec3] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

const roundVec = (v: Vec3): Vec3 => [roundNumber(v[0]), roundNumber(v[1]), roundNumber(v[2])];

/** A unit quaternion on the number grid with w ≥ 0 (q and -q are the same turn). */
function roundQuat(q: Quat): Quat {
  const unit = qnormalize(q);
  const sign = unit[3] < 0 ? -1 : 1;
  return [
    roundNumber(unit[0] * sign),
    roundNumber(unit[1] * sign),
    roundNumber(unit[2] * sign),
    roundNumber(unit[3] * sign),
  ];
}

/** True when an ancestor of the entity is in the set. */
function underAny(doc: EntityDocument, id: string, set: ReadonlySet<string>): boolean {
  const seen = new Set<string>([id]);
  let parent = doc.entities[id]?.parent ?? null;
  while (parent !== null && !seen.has(parent)) {
    if (set.has(parent)) return true;
    seen.add(parent);
    parent = doc.entities[parent]?.parent ?? null;
  }
  return false;
}

/**
 * The entities that a transform edit changes, in the order of the selection: each known entity with a `transform`
 * component, without an entity whose ancestor is in the list (it moves with its ancestor), and without a locked one.
 */
export function transformTargets(
  doc: EntityDocument,
  ids: readonly string[],
  locked: (id: string) => boolean = () => false,
): string[] {
  const known = ids.filter((id) => doc.entities[id]?.components.transform !== undefined && !locked(id));
  const set = new Set(known);
  return known.filter((id, index) => known.indexOf(id) === index && !underAny(doc, id, set));
}

/** The centre of the world origins of entities, or null for no entity. */
export function originCentre(doc: EntityDocument, ids: readonly string[]): Vec3 | null {
  let sum: Vec3 = [0, 0, 0];
  let count = 0;
  for (const id of ids) {
    const world = worldTransform(doc, id);
    if (world === undefined) continue;
    sum = vadd(sum, world.position);
    count += 1;
  }
  return count === 0 ? null : vscale(sum, 1 / count);
}

/**
 * The frame of the gizmo of the targets: at the origin of the primary (first) target or at the centre, with the world
 * axes or the axes of the primary target. Null for no target.
 */
export function gizmoFrame(
  doc: EntityDocument,
  targets: readonly string[],
  space: TransformSpace,
  pivot: TransformPivot,
): GizmoFrame | null {
  const first = targets[0];
  const world = first === undefined ? undefined : worldTransform(doc, first);
  if (world === undefined) return null;
  const origin = pivot === "centre" ? (originCentre(doc, targets) ?? world.position) : world.position;
  if (space === "world") return { origin, axes: WORLD_AXES };
  const axes = WORLD_AXES.map((axis) => qrotate(world.rotation, axis)) as unknown as [Vec3, Vec3, Vec3];
  return { origin, axes };
}

/** The world transform of the parent of an entity, or null at the root. */
function parentWorld(doc: EntityDocument, id: string): WorldTransform | null {
  const parent = doc.entities[id]?.parent ?? null;
  return parent === null ? null : (worldTransform(doc, parent) ?? null);
}

/** A world point in the frame of the parent of an entity (its local position). */
function toLocalPoint(doc: EntityDocument, id: string, point: Vec3): Vec3 {
  const parent = parentWorld(doc, id);
  if (parent === null) return point;
  const turned = qrotate(qconjugate(parent.rotation), vsub(point, parent.position));
  return [turned[0] / parent.scale[0], turned[1] / parent.scale[1], turned[2] / parent.scale[2]];
}

/** A world rotation in the frame of the parent of an entity (its local rotation). */
function toLocalRotation(doc: EntityDocument, id: string, rotation: Quat): Quat {
  const parent = parentWorld(doc, id);
  return parent === null ? rotation : qmul(qconjugate(parent.rotation), rotation);
}

function setOp(id: string, field: "position" | "rotation" | "scale", value: Vec3 | Quat): SceneOp {
  return { op: "set", path: `/entities/${id}/components/transform/${field}`, value: [...value] };
}

/** The ops of a move of the targets by a world vector. */
export function moveOps(doc: EntityDocument, targets: readonly string[], delta: Vec3): SceneOp[] {
  const ops: SceneOp[] = [];
  for (const id of targets) {
    const world = worldTransform(doc, id);
    if (world === undefined) continue;
    ops.push(setOp(id, "position", roundVec(toLocalPoint(doc, id, vadd(world.position, delta)))));
  }
  return ops;
}

/**
 * The ops of a turn of the targets by `angle` radians about a world axis (a unit vector) through each origin
 * ("pivot") or through `centre` ("centre", and the origins also turn about it).
 */
export function turnOps(
  doc: EntityDocument,
  targets: readonly string[],
  axis: Vec3,
  angle: number,
  centre: Vec3 | null,
): SceneOp[] {
  const turn = qfromAxisAngle(axis, angle);
  const ops: SceneOp[] = [];
  for (const id of targets) {
    const world = worldTransform(doc, id);
    if (world === undefined) continue;
    ops.push(setOp(id, "rotation", roundQuat(toLocalRotation(doc, id, qmul(turn, world.rotation)))));
    if (centre === null) continue;
    const moved = vadd(centre, qrotate(turn, vsub(world.position, centre)));
    ops.push(setOp(id, "position", roundVec(toLocalPoint(doc, id, moved))));
  }
  return ops;
}

/**
 * The ops of a scale of the targets: the local scale of each entity times the factor of each of its axes. With a
 * `frame` (the centre pivot), each origin moves away from the frame origin by the factors along the frame axes.
 */
export function scaleOps(
  doc: EntityDocument,
  targets: readonly string[],
  factors: Vec3,
  frame: GizmoFrame | null,
): SceneOp[] {
  const ops: SceneOp[] = [];
  for (const id of targets) {
    const entity = doc.entities[id];
    const world = worldTransform(doc, id);
    if (entity === undefined || world === undefined) continue;
    const scale = localTransform(entity).scale;
    ops.push(setOp(id, "scale", roundVec([scale[0] * factors[0], scale[1] * factors[1], scale[2] * factors[2]])));
    if (frame === null) continue;
    const offset = vsub(world.position, frame.origin);
    let moved = frame.origin;
    frame.axes.forEach((axis, index) => {
      moved = vadd(moved, vscale(axis, vdot(offset, axis) * factors[index as AxisIndex]));
    });
    ops.push(setOp(id, "position", roundVec(toLocalPoint(doc, id, moved))));
  }
  return ops;
}

/** The factors of a scale on one axis (the others stay 1), or on each axis for null (a uniform scale). */
export function axisFactors(axis: AxisIndex | null, factor: number): Vec3 {
  if (axis === null) return [factor, factor, factor];
  const factors: Vec3 = [1, 1, 1];
  factors[axis] = factor;
  return factors;
}
