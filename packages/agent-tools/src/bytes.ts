// SPDX-License-Identifier: Apache-2.0
/**
 * The bytes of a bridge answer over a socket of the studio. The editor window sends each `Uint8Array` as
 * `{ $bytes: <base64> }`. A host gives the value to the tools, with each such object as a `Uint8Array`.
 */

/** A value of an answer with each `{ $bytes: <base64> }` as a `Uint8Array`. */
export function reviveBytes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reviveBytes);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 1 && typeof record.$bytes === "string")
    return new Uint8Array(Buffer.from(record.$bytes, "base64"));
  return Object.fromEntries(keys.map((key) => [key, reviveBytes(record[key])]));
}
