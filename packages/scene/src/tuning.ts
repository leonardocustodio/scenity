// SPDX-License-Identifier: Apache-2.0
/**
 * The tune registry of a scene. The lab changes these constants while the scene runs. Thus an agent or the owner
 * tunes a pose or a place without a rebuild.
 *
 * `tunable(key, value)` registers an object of numbers (or of number arrays, or of such objects) and returns the same
 * object. The code reads the object as usual. The lab tools (`@scenity/runtime-dev`, tune.ts) change the numbers in
 * place. A case never changes them: the values stay the defaults.
 *
 * Each import path (`@scenity/scene/tuning`, `@scenity/runtime/tuning`) reaches this one module, so the code has one
 * TUNE_REGISTRY.
 */

/**
 * The compile-time constant of the tune registry. The labs app defines `__ROOM3D_LAB__` as true. A build that defines
 * it as false lets the bundler remove the registry from the render worker and the main-thread core. Without the
 * definition (the player, the scene page and the Bun tests), the registry is on. The other lab tools are in
 * `@scenity/runtime-dev`, not behind this constant.
 */
declare const __ROOM3D_LAB__: boolean | undefined;

export const ROOM3D_LAB: boolean = typeof __ROOM3D_LAB__ === "boolean" ? __ROOM3D_LAB__ : true;

/** A registered object, a copy of its defaults and the note of the key. */
export interface TuneEntry {
  readonly value: Record<string, unknown>;
  readonly defaults: unknown;
  readonly note: string | undefined;
}

/** The registered objects by key, in the order of registration. A production build keeps it empty (ROOM3D_LAB). */
export const TUNE_REGISTRY = new Map<string, TuneEntry>();

/** Register an object of numbers under `key` and return it (the same object, so the code reads it as usual). */
export function tunable<T extends object>(key: string, value: T, note?: string): T {
  // A production build has no lab: the values stay as they are, with no copy and no registry (ROOM3D_LAB).
  if (ROOM3D_LAB)
    TUNE_REGISTRY.set(key, { value: value as Record<string, unknown>, defaults: structuredClone(value), note });
  return value;
}
