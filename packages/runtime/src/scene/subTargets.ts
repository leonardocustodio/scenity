// SPDX-License-Identifier: Apache-2.0
/**
 * The sub-targets of an entity: the points that an `entity:<id>#<sub>` reference names. A sub is
 * a socket point of the `socket` component, a point of the `path` component (`path.<index>`), or a bone of the model
 * (a canonical humanoid bone through the rig of the `character` component, else the node name). The pick names the
 * nearest sub-target of a hit, and the projected points of the core resolve each reference with this module.
 */
import { Vector3, type Object3D } from "three";
import { boneNode, characterBones } from "@scenity/character/characterRig";
import type { CharacterValue, PathValue, SocketPoint, SocketValue } from "@scenity/scene/components";
import { SUB_PATTERN } from "@scenity/scene/schema/common";
import type { PickSubKind } from "../protocolScene";
import { entityModel } from "./animate";
import type { SceneBuilder } from "./builder";

/** The kinds of sub-target. */
export type SubKind = PickSubKind;

export const SUB_KINDS: readonly SubKind[] = ["socket", "bone", "pathPoint"];

/** One sub-target of an entity: its kind, its name in the reference and its world point. */
export interface SubPoint {
  readonly kind: SubKind;
  readonly id: string;
  readonly at: Vector3;
}

/** The world point of a reference, and false when its object does not show. */
export interface RefPoint {
  readonly at: Vector3;
  readonly visible: boolean;
}

/** The sub name of the path point with this index. */
export function pathPointSub(index: number): string {
  return `path.${String(index)}`;
}

/** True when the object and each of its parents show. */
export function shown(object: Object3D): boolean {
  for (let node: Object3D | null = object; node !== null; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

/** The stored value of a component of an entity in the current document of the builder. */
function stored(builder: SceneBuilder, id: string, component: string): unknown {
  return builder.document().entities[id]?.components[component];
}

function socketPosition(point: SocketPoint): readonly [number, number, number] {
  return Array.isArray(point) ? point : point.position;
}

/** A local point of an entity in world space. */
function worldPoint(group: Object3D, local: readonly [number, number, number]): Vector3 {
  return new Vector3(local[0], local[1], local[2]).applyMatrix4(group.matrixWorld);
}

/** The socket points of an entity in world space. */
function socketPoints(builder: SceneBuilder, id: string, group: Object3D): SubPoint[] {
  const points = (stored(builder, id, "socket") as SocketValue | undefined)?.points ?? {};
  return Object.keys(points)
    .sort()
    .map((name) => ({ kind: "socket", id: name, at: worldPoint(group, socketPosition(points[name] ?? [0, 0, 0])) }));
}

/** The points of the path of an entity in world space. */
function pathPoints(builder: SceneBuilder, id: string, group: Object3D): SubPoint[] {
  const points = (stored(builder, id, "path") as PathValue | undefined)?.points ?? [];
  return points.map((point, index) => ({ kind: "pathPoint", id: pathPointSub(index), at: worldPoint(group, point) }));
}

/** The bones of the model of an entity in world space: by the canonical name of the rig, else by the node name. */
function bonePoints(builder: SceneBuilder, id: string, group: Object3D): SubPoint[] {
  const model = entityModel(group);
  if (model === undefined) return [];
  const character = stored(builder, id, "character") as CharacterValue | undefined;
  const canonical = new Map<string, string>();
  if (character !== undefined) {
    for (const [bone, node] of characterBones(model, character)) canonical.set(node, bone);
  }
  const out: SubPoint[] = [];
  model.traverse((node) => {
    if ((node as Partial<{ isBone: boolean }>).isBone !== true) return;
    const name = canonical.get(node.name) ?? node.name;
    if (SUB_PATTERN.test(name)) out.push({ kind: "bone", id: name, at: node.getWorldPosition(new Vector3()) });
  });
  return out;
}

/** The sub-targets of the kinds in `kinds` of an entity, in world space. The world matrices must be current. */
export function subPoints(builder: SceneBuilder, id: string, kinds: ReadonlySet<SubKind>): SubPoint[] {
  const group = builder.entityObject(id);
  if (group === undefined) return [];
  const out: SubPoint[] = [];
  if (kinds.has("socket")) out.push(...socketPoints(builder, id, group));
  if (kinds.has("pathPoint")) out.push(...pathPoints(builder, id, group));
  if (kinds.has("bone")) out.push(...bonePoints(builder, id, group));
  return out;
}

/** The sub-target nearest to a world point, or null when the entity has none of these kinds. */
export function nearestSub(
  builder: SceneBuilder,
  id: string,
  kinds: ReadonlySet<SubKind>,
  point: Vector3,
): SubPoint | null {
  let best: SubPoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const sub of subPoints(builder, id, kinds)) {
    const distance = sub.at.distanceToSquared(point);
    if (distance < bestDistance) {
      best = sub;
      bestDistance = distance;
    }
  }
  return best;
}

/** The world point of a sub of an entity: a socket first, then a path point, then a bone (as the attach keys). */
function subPoint(builder: SceneBuilder, id: string, group: Object3D, sub: string): RefPoint | null {
  const socket = (stored(builder, id, "socket") as SocketValue | undefined)?.points?.[sub];
  if (socket !== undefined) return { at: worldPoint(group, socketPosition(socket)), visible: shown(group) };
  const path = (stored(builder, id, "path") as PathValue | undefined)?.points ?? [];
  const index = path.findIndex((_point, each) => pathPointSub(each) === sub);
  const point = path[index];
  if (point !== undefined) return { at: worldPoint(group, point), visible: shown(group) };
  const model = entityModel(group);
  if (model === undefined) return null;
  const character = stored(builder, id, "character") as CharacterValue | undefined;
  const node = boneNode(model, character === undefined ? new Map() : characterBones(model, character), sub);
  return node === undefined ? null : { at: node.getWorldPosition(new Vector3()), visible: shown(node) };
}

/**
 * The world point of `entity:<id>` (the origin of the entity) or `entity:<id>#<sub>`, or null when the reference
 * does not resolve (another text, an unknown entity or sub, a model that did not load).
 */
export function refPoint(builder: SceneBuilder, ref: string): RefPoint | null {
  if (!ref.startsWith("entity:")) return null;
  const rest = ref.slice(7);
  const hash = rest.indexOf("#");
  const id = hash < 0 ? rest : rest.slice(0, hash);
  const group = builder.entityObject(id);
  if (group === undefined) return null;
  builder.root.updateMatrixWorld(true);
  if (hash < 0) return { at: group.getWorldPosition(new Vector3()), visible: shown(group) };
  return subPoint(builder, id, group, rest.slice(hash + 1));
}
