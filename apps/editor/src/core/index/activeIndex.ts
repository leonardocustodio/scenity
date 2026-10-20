// SPDX-License-Identifier: Apache-2.0
/**
 * The current frame index of the lab page. useLabIndex.ts sets it, and the bridge calls (bridgeCalls.ts) read it. It
 * is a module of its own, thus the bridge does not import the page code.
 */
import type { LabIndex } from "./useLabIndex";

let active: LabIndex | null = null;

/** The current lab index of the page, or null. */
export function activeLabIndex(): LabIndex | null {
  return active;
}

/** Set the lab index of the page (null when it stops; only the index that is set can clear itself). */
export function setActiveLabIndex(next: LabIndex | null, current?: LabIndex): void {
  if (next === null && current !== undefined && active !== current) return;
  active = next;
}
