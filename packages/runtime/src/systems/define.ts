// SPDX-License-Identifier: Apache-2.0
/** `defineSystem`: make a system definition and check its ID, its order and its memory functions. */
import type { SystemDefinition, SystemSpec } from "./types";

/** The pattern of a system ID: the pattern of a component ID of `@scenity/scene`. */
export const SYSTEM_ID_PATTERN = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9-]*)*$/;

/**
 * Make a system definition. A system that keeps memory gives both `save` and `restore`, or neither. The object of
 * the result is the object of the input, so the methods keep their `this`.
 */
export function defineSystem<I = unknown, M = unknown>(spec: SystemSpec<I, M>): SystemDefinition<I, M> {
  if (!SYSTEM_ID_PATTERN.test(spec.id)) throw new Error(`"${spec.id}" is not a system ID`);
  if (!Number.isFinite(spec.order)) throw new Error(`${spec.id}: the order must be a finite number`);
  if ((spec.save === undefined) !== (spec.restore === undefined)) {
    throw new Error(`${spec.id}: a system with memory gives both save and restore`);
  }
  (spec as { reads?: readonly string[] }).reads ??= [];
  return spec as SystemDefinition<I, M>;
}
