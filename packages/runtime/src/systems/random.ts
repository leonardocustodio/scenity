// SPDX-License-Identifier: Apache-2.0
/**
 * The named random streams of the systems. Each stream is a mulberry32 generator. Its seed is
 * a hash of the document ID, the stream key and the seed of the runner. The state of each stream is one integer, so
 * the system memory can save it as plain JSON.
 */

/** The 32-bit FNV-1a hash of a text, as an unsigned integer. */
export function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The seed of a stream: a hash of the document ID, the stream key and the seed of the runner. */
export function streamSeed(documentId: string, key: string, seed: number | string): number {
  return hashText(`${documentId}\u0000${key}\u0000${String(seed)}`);
}

/** One random stream. The same state gives the same values. */
export class RandomStream {
  #state: number;

  constructor(state: number) {
    this.#state = state >>> 0;
  }

  /** The state of the stream: an unsigned 32-bit integer. */
  get state(): number {
    return this.#state;
  }

  /** The next value in [0, 1). */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(this.#state ^ (this.#state >>> 15), this.#state | 1);
    value = (value + Math.imul(value ^ (value >>> 7), value | 61)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  /** The next value in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** The next integer in [min, max). */
  int(min: number, max: number): number {
    return Math.floor(this.range(Math.ceil(min), Math.ceil(max)));
  }

  /** One item of a list that is not empty. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("pick needs a list that is not empty");
    return items[this.int(0, items.length)] as T;
  }
}

/** The saved states of the streams, by stream key. */
export type RandomStates = Readonly<Record<string, number>>;

/** The streams of one runner. A stream starts at its first use. */
export class RandomStreams {
  readonly #streams = new Map<string, RandomStream>();
  readonly #documentId: string;
  readonly #seed: number | string;

  constructor(documentId: string, seed: number | string) {
    this.#documentId = documentId;
    this.#seed = seed;
  }

  /** The stream of a key. The first call makes it from its seed. */
  get(key: string): RandomStream {
    let stream = this.#streams.get(key);
    if (stream === undefined) {
      stream = new RandomStream(streamSeed(this.#documentId, key, this.#seed));
      this.#streams.set(key, stream);
    }
    return stream;
  }

  /** The state of each stream in use, with the keys in sort order. */
  save(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const key of [...this.#streams.keys()].sort()) out[key] = this.get(key).state;
    return out;
  }

  /** Set the streams to saved states. A stream that the states do not hold starts again from its seed. */
  restore(states: RandomStates): void {
    this.#streams.clear();
    for (const key of Object.keys(states).sort()) {
      const state = states[key];
      if (typeof state !== "number" || !Number.isInteger(state)) throw new TypeError(`bad random state for "${key}"`);
      this.#streams.set(key, new RandomStream(state));
    }
  }
}
