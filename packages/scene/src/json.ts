// SPDX-License-Identifier: Apache-2.0
/**
 * The JSON values of the documents and small pure helpers for them. The documents are plain JSON: objects,
 * arrays, strings, finite numbers, booleans and null.
 */
import type { z } from "zod";

/** A JSON value: the type of `z.json()`. */
export type JsonValue = z.infer<ReturnType<typeof z.json>>;

/** A copy of an object with the given keys left out. */
export function omitKeys<T extends Record<string, unknown>>(value: T, keys: readonly string[]): T {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key))) as T;
}

/** True when the value is a plain object (not an array and not null). */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when the two JSON values are equal. The key order of an object does not change the result. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => jsonEqual(item, b[index]));
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]));
  }
  return false;
}

/**
 * The defaults with the value on top: the function merges plain objects key by key, at all depths. An array or a
 * primitive of the value replaces the default.
 */
export function mergeDefaults(defaults: unknown, value: unknown): unknown {
  if (!isObject(defaults) || !isObject(value)) return value === undefined ? defaults : value;
  const out: Record<string, unknown> = { ...defaults };
  for (const [key, item] of Object.entries(value)) out[key] = mergeDefaults(defaults[key], item);
  return out;
}

/** The keys of an object in code-unit order, as the canonical writer writes them. */
export function sortedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
