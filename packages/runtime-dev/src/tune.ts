// SPDX-License-Identifier: Apache-2.0
/**
 * The tune API of the labs: the lab reads and changes the constants that the runtime registers with `tunable`
 * (`@scenity/runtime/tuning`, TUNE_REGISTRY), so an agent or the owner tunes a pose or a place without a rebuild, then
 * copies the values into the code.
 *
 * `applyTunes` changes the registered numbers in place (each other number back to its default), so the next frame uses
 * the new values. A case never calls applyTunes: the values stay the defaults.
 */
import { TUNE_REGISTRY as REGISTRY } from "@scenity/runtime/tuning";

/** A tuned number: the path is the key and the place in the object, for example `pose.maskHand.fingers.0`. */
export interface Tunable {
  readonly path: string;
  readonly value: number;
  readonly default: number;
  /** The step of the field in the lab (from the size of the default). */
  readonly step: number;
}

/** The numbers of a value with their paths. */
function leaves(value: unknown, path: string, out: [string, number][]): void {
  if (typeof value === "number") {
    out.push([path, value]);
  } else if (Array.isArray(value)) {
    value.forEach((item: unknown, index) => {
      leaves(item, `${path}.${String(index)}`, out);
    });
  } else if (typeof value === "object" && value !== null) {
    for (const [name, item] of Object.entries(value)) leaves(item, `${path}.${name}`, out);
  }
}

function stepOf(value: number): number {
  const size = Math.abs(value);
  if (size === 0) return 0.001;
  return 10 ** Math.floor(Math.log10(size) - 1.5);
}

/** Every tuned number with its default and its current value, in the order of registration. */
export function tunables(): Tunable[] {
  const out: Tunable[] = [];
  for (const [key, entry] of REGISTRY) {
    const now: [string, number][] = [];
    const base: [string, number][] = [];
    leaves(entry.value, key, now);
    leaves(entry.defaults, key, base);
    now.forEach(([path, value], index) => {
      const fallback = base[index]?.[1] ?? value;
      out.push({ path, value, default: fallback, step: stepOf(fallback) });
    });
  }
  return out;
}

/** The note of a key (why the value is what it is), or undefined. */
export function tuneNote(key: string): string | undefined {
  return REGISTRY.get(key)?.note;
}

/** The registered key of a path: the longest key that starts the path. */
export function tuneKey(path: string): string | undefined {
  let found: string | undefined;
  for (const key of REGISTRY.keys()) {
    if ((path === key || path.startsWith(`${key}.`)) && (found === undefined || key.length > found.length)) found = key;
  }
  return found;
}

/** Copy the numbers of `from` into `into` (the same shape), in place. */
function copyInto(into: unknown, from: unknown): void {
  if (Array.isArray(into) && Array.isArray(from)) {
    from.forEach((item: unknown, index) => {
      if (typeof item === "number") into[index] = item;
      else copyInto(into[index], item);
    });
  } else if (typeof into === "object" && into !== null && typeof from === "object" && from !== null) {
    const target = into as Record<string, unknown>;
    for (const [name, item] of Object.entries(from)) {
      if (typeof item === "number") target[name] = item;
      else copyInto(target[name], item);
    }
  }
}

/** Set one number at a path; false when the path is not a tuned number. */
function setPath(path: string, value: number): boolean {
  const key = tuneKey(path);
  if (key === undefined) return false;
  const parts = path.slice(key.length + 1).split(".");
  let node: unknown = REGISTRY.get(key)?.value;
  for (const part of parts.slice(0, -1)) {
    if (typeof node !== "object" || node === null) return false;
    node = (node as Record<string, unknown>)[part];
  }
  const last = parts.at(-1);
  if (typeof node !== "object" || node === null || last === undefined) return false;
  const target = node as Record<string, unknown>;
  if (typeof target[last] !== "number") return false;
  target[last] = value;
  return true;
}

/**
 * Set the tuned numbers: each number of `values` at its path, every other number at its default. Returns the keys whose
 * numbers changed and the paths that are not tuned numbers.
 */
export function applyTunes(values: Readonly<Record<string, number>>): { changed: string[]; unknown: string[] } {
  const before = new Map<string, string>();
  for (const [key, entry] of REGISTRY) {
    before.set(key, JSON.stringify(entry.value));
    copyInto(entry.value, entry.defaults);
  }
  const unknown: string[] = [];
  for (const [path, value] of Object.entries(values)) {
    if (!Number.isFinite(value) || !setPath(path, value)) unknown.push(path);
  }
  const changed = [...REGISTRY]
    .filter(([key, entry]) => before.get(key) !== JSON.stringify(entry.value))
    .map(([key]) => key);
  return { changed, unknown };
}

/** Tune values as the text of the `tune` URL parameter: `path:value,path:value`. */
export function tuneText(values: Readonly<Record<string, number>>): string {
  return Object.entries(values)
    .map(([path, value]) => `${path}:${String(value)}`)
    .join(",");
}

/** The tune values of the text of the `tune` URL parameter (pairs that are not `path:number` are left out). */
export function parseTunes(text: string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of (text ?? "").split(",")) {
    const at = pair.lastIndexOf(":");
    if (at <= 0) continue;
    const value = Number(pair.slice(at + 1));
    if (Number.isFinite(value)) out[pair.slice(0, at)] = value;
  }
  return out;
}

/** Tune values with one value changed: `null` (or the default) takes the path out. */
export function withTune(
  values: Readonly<Record<string, number>>,
  path: string,
  value: number | null,
  fallback?: number,
): Record<string, number> {
  const rest = Object.fromEntries(Object.entries(values).filter(([key]) => key !== path));
  return value === null || value === fallback ? rest : { ...rest, [path]: value };
}
