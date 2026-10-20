// SPDX-License-Identifier: Apache-2.0
/**
 * The target of a camera or a light: a world point or an entity reference `entity:<id>`. This module ignores a socket
 * or bone name of the reference: the target is then the origin of the entity.
 */
import type { Vector3 } from "three";
import type { Vec3 } from "@scenity/scene/schema/common";
import { parseRef } from "@scenity/scene/refs";
import type { PresenterContext } from "../types";

/** The world point of a target into `out`, or undefined with no target or when the target entity does not exist. */
export function targetPoint(
  target: Vec3 | string | undefined,
  ctx: PresenterContext,
  out: Vector3,
): Vector3 | undefined {
  if (target === undefined) return undefined;
  if (Array.isArray(target)) return out.fromArray(target);
  const ref = parseRef(target);
  const object = ref?.kind === "entity" ? ctx.entityObject(ref.id) : undefined;
  return object?.getWorldPosition(out);
}
