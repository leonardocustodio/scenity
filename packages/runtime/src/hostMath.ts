// SPDX-License-Identifier: Apache-2.0
/**
 * Two math helpers that the host API uses: the percentile of the adaptive quality and a stable offset. They are in
 * their own module, so the page chunks of a runtime user do not carry the vector helpers that the core uses.
 */

/** The value at a share of the sorted values (0.95: the 95th percentile), or 0 for no values. */
export function percentile(values: readonly number[], share: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))] ?? 0;
}

/**
 * A stable offset in ms from an ID (FNV-1a), for idle variation. It is in this module, so the page chunks do not load
 * the pose model.
 */
export function stableOffset(id: string, range = 4000): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % range;
}
