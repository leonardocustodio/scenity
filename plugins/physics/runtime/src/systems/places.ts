// SPDX-License-Identifier: Apache-2.0
/**
 * The places of the physics plugin: the world place of an entity for a body, and the local transform of an
 * entity from the world place of its body. The physics world is in world space. The transform outputs of a system are
 * in the frame of the parent of the entity.
 */
import { qconjugate, qmul, qrotate, vsub, type Quat, type Vec3 } from "@scenity/scene/math";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { TransformOutput } from "@scenity/runtime/systems";
import { worldTransform } from "@scenity/scene/world";

/** A world position and rotation. */
export interface Place {
  readonly position: Vec3;
  readonly rotation: Quat;
}

/** The world place of an entity, or undefined for an unknown entity. */
export function worldPlace(scene: SceneDocument, id: string): Place | undefined {
  const place = worldTransform(scene, id);
  return place === undefined ? undefined : { position: place.position, rotation: place.rotation };
}

/**
 * The local transform of an entity from a world position and an optional world rotation. With no parent (or an
 * unknown parent), the local transform is the world place.
 */
export function localPlace(
  scene: SceneDocument,
  parent: string | null,
  position: Vec3,
  rotation: Quat | undefined,
): TransformOutput {
  const frame = parent === null ? undefined : worldTransform(scene, parent);
  if (frame === undefined) return rotation === undefined ? { position } : { position, rotation };
  const inverse = qconjugate(frame.rotation);
  const [x, y, z] = qrotate(inverse, vsub(position, frame.position));
  const [sx, sy, sz] = frame.scale;
  const local: Vec3 = [sx === 0 ? 0 : x / sx, sy === 0 ? 0 : y / sy, sz === 0 ? 0 : z / sz];
  return rotation === undefined ? { position: local } : { position: local, rotation: qmul(inverse, rotation) };
}
