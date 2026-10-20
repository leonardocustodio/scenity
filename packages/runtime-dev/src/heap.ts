// SPDX-License-Identifier: Apache-2.0
/**
 * The used JS heap of the thread of the core for its statistics.
 */

/** The used JS heap of this thread in MB (Chromium only), or null. */
export function heapMb(): number | null {
  const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return memory === undefined ? null : Math.round((memory.usedJSHeapSize / 1048576) * 10) / 10;
}
