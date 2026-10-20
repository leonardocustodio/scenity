// SPDX-License-Identifier: Apache-2.0
/**
 * The text form of a Rapier snapshot: the system memory is plain JSON, so the bytes of
 * `World.takeSnapshot` go into it as base64 text.
 */

/** The bytes in one call of `String.fromCharCode`: below the argument limit of the engines. */
const CHUNK = 0x8000;

/** The base64 text of bytes. */
export function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(start, start + CHUNK));
  }
  return btoa(binary);
}

/** The bytes of a base64 text. */
export function decodeBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
