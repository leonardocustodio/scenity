// SPDX-License-Identifier: Apache-2.0
/** Shared helpers of the tests of @scenity/scene: the fixtures, a seeded random generator and a deep freeze. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { builtinRegistry, readDocument, type DocumentKind, type DocumentOfKind } from "../src/index";

export const FIXTURES = join(import.meta.dir, "fixtures");

/** The fixtures in the current format: each one reads and writes to the same bytes. */
export const CURRENT_FIXTURES = [
  ...readdirSync(FIXTURES).filter((name) => name.endsWith(".json") && !/\.v[0-9]+\./.test(name)),
  "plugin-project/scenity.project.json",
  "plugin-project/scenes/main.scene.json",
];

export function fixtureText(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

/** Read a fixture that must be valid. */
export function fixture<K extends DocumentKind>(name: string, kind: K): DocumentOfKind[K] {
  const result = readDocument(fixtureText(name), kind);
  if (!result.ok) throw new Error(`${name}: ${JSON.stringify(result.errors)}`);
  return result.doc;
}

export const registry = builtinRegistry();

/** A seeded random generator (mulberry32): the same seed gives the same numbers on each run. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Freeze a value at all depths, so a change of the input by the code under test throws. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
