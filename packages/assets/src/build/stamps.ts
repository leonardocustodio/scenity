// SPDX-License-Identifier: Apache-2.0
/**
 * The input stamps of the pictures that a browser renders, for example a poster of a scene or the stills of a content
 * browser. The render depends on the GPU, so the byte check of the build cannot make them again. A stamp keeps the hash
 * of the inputs of the pictures when a script made them. The asset check warns when the inputs changed after that.
 *
 * The caller names the inputs (StampInputs): the source files of the render and the groups of the manifest whose
 * models the pictures show. The built models count by their SHA-256 in the manifest. A caller can give `groups`: the
 * groups of a manifest in its own view (for example, a plugin reads its groups from the records of manifest 2).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The inputs of one kind of picture. */
export interface StampInputs {
  /** The folder that the paths of `files` are relative to (the repo root). */
  readonly root: string;
  /** The source files of the render, relative to `root`. */
  readonly files: readonly string[];
  /** The folder of a file of `files` that is not under `root` (a file of a linked checkout). Default: `root`. */
  readonly rootOf?: (path: string) => string;
  /** The manifest file (an absolute path) and the groups of it whose models the pictures show. */
  readonly manifest: string;
  readonly models: readonly string[];
  /** The groups of the manifest JSON (default: the top-level fields of the file). */
  readonly groups?: (manifest: unknown) => Readonly<Record<string, unknown>>;
  /** The command that makes the pictures again. */
  readonly make: string;
}

interface Stamp {
  readonly inputs: string;
  readonly made: string;
}

/** The current hash of the inputs of a kind of picture. */
export function inputHash(inputs: StampInputs): string {
  const hash = createHash("sha256");
  for (const path of inputs.files)
    hash.update(path).update(readFileSync(join(inputs.rootOf?.(path) ?? inputs.root, path)));
  const json = JSON.parse(readFileSync(inputs.manifest, "utf8")) as Record<string, unknown>;
  const manifest = inputs.groups === undefined ? json : inputs.groups(json);
  for (const group of inputs.models) hash.update(group).update(JSON.stringify(manifest[group] ?? null));
  return hash.digest("hex");
}

/** Write the stamp of a kind of picture at `path`: a script calls it after it wrote the pictures. */
export function writeStamp(inputs: StampInputs, path: string, today = new Date()): void {
  const stamp: Stamp = { inputs: inputHash(inputs), made: today.toISOString().slice(0, 10) };
  writeFileSync(path, `${JSON.stringify(stamp, null, 2)}\n`);
}

/** Null when a script made the pictures of the stamp at `path` from the current inputs, else the warning. */
export function staleness(inputs: StampInputs, path: string): string | null {
  const make = `make them again: ${inputs.make}`;
  if (!existsSync(path)) return `no input stamp, so the pictures can be stale; ${make}`;
  const stamp = JSON.parse(readFileSync(path, "utf8")) as Stamp;
  if (stamp.inputs === inputHash(inputs)) return null;
  return `the inputs changed after ${stamp.made} (${inputs.files.join(", ")} or the models); ${make}`;
}
