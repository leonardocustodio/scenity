// SPDX-License-Identifier: Apache-2.0
/**
 * The frame index of the workbench host for the `labs` tools. The tools read (and the stills write) the files of the
 * host store under the state folder of the checkout (`<state>/index/…`, packages/workbench-host/src/index/files.ts).
 * They use the store core of `@scenity/labs-platform`.
 * apps/editor does not import the host, so this file has its own small file backend with the same rules: relative
 * paths of safe names only, and a new file appears whole (a write to a temporary file, then a rename).
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HOST_INDEX_LIMIT, IndexStore, type IndexBackend } from "@scenity/labs-platform/indexStore";
import { checkoutRoot, hostStateDir } from "./pool/paths";
import { envValue } from "@scenity/labs-platform/envNames";

const SAFE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

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

/** The files of an index store under `root` (the state folder of the host). */
export function nodeIndexFiles(root: string): IndexBackend {
  return {
    read: (path) => {
      try {
        return Promise.resolve(new Uint8Array(readFileSync(fullPath(root, path))));
      } catch {
        return Promise.resolve(null);
      }
    },
    write: (path, bytes) => {
      const file = fullPath(root, path);
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomBytes(4).toString("hex")}.tmp`;
      writeFileSync(temporary, bytes, { mode: 0o600 });
      renameSync(temporary, file);
      return Promise.resolve();
    },
    remove: (path) => {
      rmSync(fullPath(root, path), { force: true });
      return Promise.resolve();
    },
    removeTree: (path) => {
      rmSync(fullPath(root, path), { recursive: true, force: true });
      return Promise.resolve();
    },
    list: (path) => {
      fullPath(root, path);
      const out: string[] = [];
      walk(root, path, out);
      return Promise.resolve(out);
    },
  };
}

/** The variable with another state folder of the index (the tests, a host with `--state`). */
export const INDEX_STATE_ENV = "SCENITY_LABS_INDEX_STATE";

/** The state folder of the index of this checkout: the variable, else the folder of the host. */
export function indexStateDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const given = envValue(INDEX_STATE_ENV, env);
  return given !== undefined && given !== "" ? given : hostStateDir(checkoutRoot());
}

/**
 * A backend that only reads: the host owns the files of its store (a write of the tool can put an older manifest
 * over a newer one of the host). A read of the store then changes no file, not even the use time of a frame.
 */
export function readOnly(backend: IndexBackend): IndexBackend {
  const nothing = (): Promise<void> => Promise.resolve();
  return {
    read: (path) => backend.read(path),
    list: (path) => backend.list(path),
    write: nothing,
    remove: nothing,
    removeTree: nothing,
  };
}

/** Open the index of the host of this checkout to read it (the limit of the host; the files stay as they are). */
export function openHostIndex(stateDir = indexStateDir()): IndexStore {
  return new IndexStore(readOnly(nodeIndexFiles(stateDir)), { limitBytes: HOST_INDEX_LIMIT });
}
