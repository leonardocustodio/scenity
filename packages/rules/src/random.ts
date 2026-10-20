// SPDX-License-Identifier: Apache-2.0
/**
 * The named random streams of the layout search. A stream is a seeded generator (mulberry32) that starts from a hash
 * of its name (FNV-1a, 32 bits). The same name gives the same numbers on each machine. The layout search of the scene
 * editor used this generator first, so a seed keeps the variants that it gave in that search.
 */

/** A hash of a text (FNV-1a, 32 bits): the start of a named random stream. */
export function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** The random stream of a name (mulberry32): numbers in [0, 1), the same for the same name. */
export function seededStream(name: string): () => number {
  let state = hashText(name);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** The name of the stream of a search: `<name>:<seed>` (the layout search of the editor uses `layout-search`). */
export function streamName(name: string, seed: number): string {
  return `${name}:${String(seed)}`;
}
