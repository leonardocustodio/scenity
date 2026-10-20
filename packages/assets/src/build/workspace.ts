// SPDX-License-Identifier: Apache-2.0
/**
 * The workspace root of the asset tools: the nearest folder above this package with a lockfile. The Blender runs use
 * it as the working folder, and the build cache hashes its lockfile. A checkout has `bun.lock`. An installed package
 * can be under a project of another package manager.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The folder of this module (`import.meta.dir` is Bun only; Vitest also loads the module). */
const HERE = dirname(fileURLToPath(import.meta.url));

/** The lockfiles of the package managers, in the order of the search in one folder. */
export const LOCKFILES = ["bun.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"] as const;

let found: { readonly root: string; readonly lockfile: string } | null = null;

/** The nearest folder above this package with a lockfile, and the name of that file. Throws when there is none. */
export function workspaceLock(): { readonly root: string; readonly lockfile: string } {
  if (found !== null) return found;
  for (let folder = HERE; ; folder = dirname(folder)) {
    const lockfile = LOCKFILES.find((name) => existsSync(join(folder, name)));
    if (lockfile !== undefined) {
      found = { root: folder, lockfile };
      return found;
    }
    if (dirname(folder) === folder) throw new Error(`no lockfile (${LOCKFILES.join(", ")}) above ${HERE}`);
  }
}

/** The nearest folder above this package that has a lockfile. Throws when no folder has one. */
export function workspaceRoot(): string {
  return workspaceLock().root;
}
