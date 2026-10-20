// SPDX-License-Identifier: Apache-2.0
/**
 * The files of the frame index in the host: an `IndexBackend`
 * over a folder of the state folder (`<state>/index/…`). Each path is relative and made only of the names that the
 * store makes (hex keys, numbers, view names), so no path leaves the folder.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import type { IndexBackend } from "@scenity/labs-platform/indexStore";

const SAFE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

/** The full path of a store path; an error for a path with `..` or another odd part. */
function fullPath(root: string, path: string): string {
  if (!SAFE.test(path) || path.split("/").some((part) => part === "." || part === "..")) {
    throw new Error(`The index refuses the path ${JSON.stringify(path)}.`);
  }
  return join(root, path);
}

function walk(root: string, path: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(join(root, path), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) walk(root, child, out);
    else if (!entry.name.endsWith(".tmp")) out.push(child);
  }
}

/** The files of the index under `root` (the state folder of the host). */
export function fileBackend(root: string): IndexBackend {
  // Each method is async, so a refused path is a rejected promise, not a thrown error.
  return {
    async read(path) {
      const file = fullPath(root, path);
      try {
        return await Promise.resolve(readFileSync(file));
      } catch {
        return null;
      }
    },
    async write(path, bytes) {
      const file = fullPath(root, path);
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      // A new file appears whole: a reader never sees half a picture or half a manifest.
      const temporary = `${file}.${randomBytes(4).toString("hex")}.tmp`;
      writeFileSync(temporary, bytes, { mode: 0o600 });
      renameSync(temporary, file);
      await Promise.resolve();
    },
    async remove(path) {
      rmSync(fullPath(root, path), { force: true });
      await Promise.resolve();
    },
    async removeTree(path) {
      rmSync(fullPath(root, path), { recursive: true, force: true });
      await Promise.resolve();
    },
    async list(path) {
      fullPath(root, path);
      const out: string[] = [];
      walk(root, path, out);
      return await Promise.resolve(out);
    },
  };
}
