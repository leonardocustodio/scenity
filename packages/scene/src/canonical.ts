// SPDX-License-Identifier: Apache-2.0
/**
 * The canonical writer of the documents. The writer sorts the keys, rounds each number to a grid of 1e-6, writes `-0`
 * as `0`, indents with two spaces and adds a final newline. An array of numbers goes on one line. Each other array and
 * each object has one item on each line. Read then write gives the same bytes.
 */
import { isObject, sortedKeys } from "./json";

/** The grid of the numbers in a document. */
export const NUMBER_GRID = 1e-6;
const SCALE = 1 / NUMBER_GRID;

/** A number on the grid of the documents, with `-0` as `0`. A non-finite number is an error. */
export function roundNumber(value: number): number {
  if (!Number.isFinite(value)) throw new Error(`a document holds only finite numbers, not ${String(value)}`);
  const rounded = Number.isInteger(value) ? value : Math.round(value * SCALE) / SCALE;
  return rounded === 0 ? 0 : rounded;
}

/** The text of a number on the grid. The text has no exponent for values from 1e-6 to 1e21. */
export function formatNumber(value: number): string {
  return String(roundNumber(value));
}

function writeValue(value: unknown, indent: string, path: string): string {
  if (value === null) return "null";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every((item) => typeof item === "number")) return `[${value.map(formatNumber).join(", ")}]`;
    const items = value.map((item, index) => inner + writeValue(item, inner, `${path}/${String(index)}`));
    return `[\n${items.join(",\n")}\n${indent}]`;
  }
  if (isObject(value)) {
    const keys = sortedKeys(value).filter((key) => value[key] !== undefined);
    if (keys.length === 0) return "{}";
    const items = keys.map(
      (key) => `${inner}${JSON.stringify(key)}: ${writeValue(value[key], inner, `${path}/${key}`)}`,
    );
    return `{\n${items.join(",\n")}\n${indent}}`;
  }
  throw new Error(`a document holds only JSON values; ${path || "/"} holds a ${typeof value}`);
}

/** The canonical text of a JSON value. The text has no object key with the value `undefined`. */
export function canonicalJson(value: unknown): string {
  return `${writeValue(value, "", "")}\n`;
}

/** The canonical text of a document (the same as `canonicalJson`, with a name that tells the purpose). */
export function writeDocument(doc: { readonly format: string }): string {
  return canonicalJson(doc);
}

/** A deep copy of a JSON value with each number on the grid, so a value in memory equals its value after a reread. */
export function canonicalValue<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}
