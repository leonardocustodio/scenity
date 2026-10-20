// SPDX-License-Identifier: Apache-2.0
/**
 * The world transform of an entity through the tree, and the world place of a socket. The runtime and the rules use
 * them. An entity with no `transform` has the identity transform.
 */
import { TRANSFORM_DEFAULTS, type Transform } from "./components/spatial";
import { isObject } from "./json";
import {
  composeMatrix,
  multiplyMatrices,
  qmul,
  qrotate,
  transformPoint,
  vadd,
  vmul,
  type Mat4,
  type Quat,
  type Vec3,
} from "./math";
import { parseRef } from "./refs";
import type { Entity } from "./schema/entity";

/** The world transform. The matrix is exact. Position, rotation and scale are exact when each scale is uniform. */
export interface WorldTransform extends Transform {
  readonly matrix: Mat4;
}

/** A document with an entity map (a scene, a prefab or an expanded scene). */
export interface HasEntities {
  readonly entities: Readonly<Record<string, Entity>>;
}

/** The local transform of an entity, with the defaults. */
export function localTransform(entity: Entity): Transform {
  const value = entity.components.transform;
  const stored = isObject(value) ? (value as Partial<Transform>) : {};
  return {
    position: stored.position ?? [...TRANSFORM_DEFAULTS.position],
    rotation: stored.rotation ?? [...TRANSFORM_DEFAULTS.rotation],
    scale: stored.scale ?? [...TRANSFORM_DEFAULTS.scale],
  };
}

/** The world transform of an entity, or undefined for an unknown entity or a cycle in the tree. */
export function worldTransform(doc: HasEntities, id: string): WorldTransform | undefined {
  const chain: Entity[] = [];
  const seen = new Set<string>();
  let next: string | null = id;
  while (next !== null) {
    const entity: Entity | undefined = doc.entities[next];
    if (entity === undefined || seen.has(next)) return undefined;
    seen.add(next);
    chain.unshift(entity);
    next = entity.parent;
  }
  let position: Vec3 = [0, 0, 0];
  let rotation: Quat = [0, 0, 0, 1];
  let scale: Vec3 = [1, 1, 1];
  let matrix = composeMatrix(position, rotation, scale);
  for (const entity of chain) {
    const local = localTransform(entity);
    position = vadd(position, qrotate(rotation, vmul(scale, local.position)));
    rotation = qmul(rotation, local.rotation);
    scale = vmul(scale, local.scale);
    matrix = multiplyMatrices(matrix, composeMatrix(local.position, local.rotation, local.scale));
  }
  return { position, rotation, scale, matrix };
}

/** The world place of a socket or a point. */
export interface WorldPoint {
  readonly position: Vec3;
  readonly rotation: Quat;
}

/**
 * The world place of a socket: `entity:<id>#<socket>`. The result is undefined when the reference is not a socket
 * reference, or when the entity or the socket does not exist. A socket with no rotation has the entity rotation.
 */
export function socketWorld(doc: HasEntities, reference: string): WorldPoint | undefined {
  const ref = parseRef(reference);
  if (ref?.kind !== "entity" || ref.sub === undefined) return undefined;
  const entity = doc.entities[ref.id];
  const socket = entity?.components.socket;
  const points = isObject(socket) && isObject(socket.points) ? socket.points : {};
  const point = points[ref.sub];
  if (point === undefined) return undefined;
  const world = worldTransform(doc, ref.id);
  if (world === undefined) return undefined;
  const local = (Array.isArray(point) ? { position: point } : point) as { position: Vec3; rotation?: Quat };
  return {
    position: transformPoint(world.matrix, local.position),
    rotation: local.rotation === undefined ? world.rotation : qmul(world.rotation, local.rotation),
  };
}
