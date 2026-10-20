// SPDX-License-Identifier: Apache-2.0
/**
 * The attach of an object to a bone or a socket. An attach key names its parent as
 * `entity:<id>#<bone or socket>`; a bone is a canonical humanoid bone (`leftHand`, `rightHand`, `head`) that the rig
 * profile of the character maps to a node. This module has no profile tables and no schema, so a render worker of a
 * plugin can use it at a small cost.
 */
import type { Object3D } from "three";

/** The parent of an attach key: the entity ID and the bone or socket name (null: the entity itself). */
export interface AttachTarget {
  readonly entity: string;
  readonly socket: string | null;
}

/**
 * The parent of an attach reference (`entity:<id>` or `entity:<id>#<bone or socket>`), or null for another text.
 * The reader of `@scenity/scene` checks the patterns of the parts.
 */
export function attachTarget(ref: string): AttachTarget | null {
  if (!ref.startsWith("entity:")) return null;
  const rest = ref.slice(7);
  const hash = rest.indexOf("#");
  if (hash < 0) return rest === "" ? null : { entity: rest, socket: null };
  return { entity: rest.slice(0, hash), socket: rest.slice(hash + 1) };
}

/**
 * Put `object` under `parent` at a local `position` (x, y, z), and keep its local rotation and scale. With no
 * position, the object keeps its local position. An object that is under the parent already does not move.
 */
export function attachTo(object: Object3D, parent: Object3D, position?: readonly [number, number, number]): void {
  if (object.parent === parent) return;
  if (position !== undefined) object.position.set(position[0], position[1], position[2]);
  parent.add(object);
}
