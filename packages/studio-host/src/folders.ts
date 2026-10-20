// SPDX-License-Identifier: Apache-2.0
/**
 * Folder access for the folder dialog of the studio. A browser page cannot read the disk. Thus the host lists the
 * folders under the allowed roots (the home folder, the checkout, the folders of the recent projects) and makes a new
 * folder. The host refuses a path outside the roots. The list does not include hidden folders and `node_modules`. A
 * folder with a project file has a mark.
 */
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { PROJECT_FILE } from "./registry";

export interface FolderEntry {
  readonly name: string;
  readonly path: string;
  readonly project: boolean;
}

export interface FolderListing {
  readonly path: string;
  /** The parent folder, or null at a root. */
  readonly parent: string | null;
  readonly project: boolean;
  readonly folders: readonly FolderEntry[];
  readonly roots: readonly string[];
}

/** True when `path` is `root` or a folder in it. */
function inside(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** The folder access over a set of roots. */
export class Folders {
  readonly roots: readonly string[];

  constructor(roots: readonly string[] = [homedir()]) {
    // The roots keep their order: the first root is the default place of a new project.
    this.roots = [...new Set(roots.map((root) => resolve(root)))].filter((root) => existsSync(root));
  }

  /** The folder `path` (absolute) when it is under a root. Else the function throws. */
  allowed(path: string): string {
    const folder = resolve(path);
    if (!this.roots.some((root) => inside(folder, root))) throw new Error(`${folder} is outside the allowed folders`);
    return folder;
  }

  list(path: string = this.roots[0] ?? homedir()): FolderListing {
    const folder = this.allowed(path);
    const folders: FolderEntry[] = [];
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const child = join(folder, entry.name);
      folders.push({ name: entry.name, path: child, project: existsSync(join(child, PROJECT_FILE)) });
    }
    folders.sort((a, b) => a.name.localeCompare(b.name));
    const isRoot = this.roots.includes(folder);
    return {
      path: folder,
      parent: isRoot ? null : dirname(folder),
      project: existsSync(join(folder, PROJECT_FILE)),
      folders,
      roots: this.roots,
    };
  }

  /** Make the folder `name` in `parent` and give its path. The name is one folder name with no path parts. */
  make(parent: string, name: string): string {
    if (name.trim() === "" || name !== basename(name) || name === "." || name === "..") {
      throw new Error(`"${name}" is not a folder name`);
    }
    const folder = join(this.allowed(parent), name);
    if (existsSync(folder) && !statSync(folder).isDirectory()) throw new Error(`${folder} is a file`);
    mkdirSync(folder, { recursive: true });
    return folder;
  }
}
