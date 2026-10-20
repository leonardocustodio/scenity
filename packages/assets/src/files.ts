// SPDX-License-Identifier: Apache-2.0
/**
 * The file helpers of the asset database. The database keeps each path relative to the project folder, with
 * `/` between the parts. The helpers read the disk through `node:fs`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { ProjectFs } from "@scenity/scene";

/** The folder names that a scan does not enter. A folder name that starts with `.` is also left out. */
export const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(["node_modules", "dist", "build", "out"]);

/** The path with `/` between the parts. */
export function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

/** The path of a file relative to the project folder, with `/` between the parts. */
export function projectPath(dir: string, file: string): string {
  return toPosix(relative(dir, file));
}

/** The text of a file, or undefined when the file does not exist or is not a file. */
export function readTextOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** The bytes of a file, or undefined when the file does not exist or is not a file. */
export function readBytesOrUndefined(path: string): Uint8Array | undefined {
  try {
    return readFileSync(path);
  } catch {
    return undefined;
  }
}

/** True when the path is a folder. */
export function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** A file reader for `loadProject` of `@scenity/scene`. */
export const nodeProjectFs: ProjectFs = { readText: readTextOrUndefined };

/** True when a scan does not enter the folder of this name. */
export function isSkippedFolder(name: string): boolean {
  return name.startsWith(".") || SKIPPED_FOLDERS.has(name);
}

/**
 * The files under a folder of the project, as project paths in sorted order. The scan does not enter the skipped
 * folders. A folder that does not exist gives no files.
 */
export function listFiles(dir: string, folder: string): string[] {
  const out: string[] = [];
  const walk = (path: string) => {
    let names: string[];
    try {
      names = readdirSync(path);
    } catch {
      return;
    }
    for (const name of names) {
      const child = join(path, name);
      if (isFolder(child)) {
        if (!isSkippedFolder(name)) walk(child);
      } else {
        out.push(projectPath(dir, child));
      }
    }
  };
  walk(join(dir, folder));
  return out.sort();
}

/** True when the project path is the folder or a path under it. */
export function isUnder(path: string, folder: string): boolean {
  const clean = folder.replace(/\/+$/, "");
  return clean === "" || clean === "." || path === clean || path.startsWith(`${clean}/`);
}
