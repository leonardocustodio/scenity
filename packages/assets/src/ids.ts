// SPDX-License-Identifier: Apache-2.0
/**
 * New asset IDs: a ULID of 26 characters in the Crockford base 32 alphabet. The first 10
 * characters encode the time in milliseconds and the last 16 characters encode 80 random bits. The functions are
 * pure: the caller gives the clock and the random source. `system.ts` has the default source.
 */

/** The Crockford base 32 alphabet of a ULID. */
export const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** The largest time that a ULID can hold (2^48 - 1 milliseconds). */
export const ULID_MAX_TIME = 2 ** 48 - 1;
/** The number of random bytes in a ULID. */
export const ULID_RANDOM_BYTES = 10;

/** The clock and the random source of the ID generator. */
export interface IdSource {
  /** The time in milliseconds since 1970-01-01T00:00:00Z. */
  now(): number;
  /** A new array of random bytes of the given length. */
  random(length: number): Uint8Array;
}

/** The ULID of a time in milliseconds and 10 random bytes. */
export function encodeUlid(time: number, random: Uint8Array): string {
  if (!Number.isInteger(time) || time < 0 || time > ULID_MAX_TIME) {
    throw new Error(`a ULID time is an integer in 0..2^48-1, not ${String(time)}`);
  }
  if (random.length !== ULID_RANDOM_BYTES) {
    throw new Error(`a ULID has ${String(ULID_RANDOM_BYTES)} random bytes, not ${String(random.length)}`);
  }
  let head = "";
  let rest = time;
  for (let index = 0; index < 10; index += 1) {
    head = charAt(rest % 32) + head;
    rest = Math.floor(rest / 32);
  }
  // The 80 random bits give 16 characters of 5 bits each.
  let tail = "";
  let bits = 0;
  let count = 0;
  for (const byte of random) {
    bits = (bits << 8) | byte;
    count += 8;
    while (count >= 5) {
      count -= 5;
      tail += charAt((bits >> count) & 31);
    }
    bits &= (1 << count) - 1;
  }
  return head + tail;
}

/** The time in milliseconds of a ULID, or undefined when the text is not a ULID. */
export function decodeUlidTime(id: string): number | undefined {
  if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(id)) return undefined;
  let time = 0;
  for (const char of id.slice(0, 10)) time = time * 32 + ULID_ALPHABET.indexOf(char);
  return time;
}

/** A new asset ID from the clock and the random source. */
export function newAssetId(source: IdSource): string {
  return encodeUlid(source.now(), source.random(ULID_RANDOM_BYTES));
}

function charAt(index: number): string {
  return ULID_ALPHABET.charAt(index);
}
