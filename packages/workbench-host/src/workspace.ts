// SPDX-License-Identifier: Apache-2.0
/**
 * The three folders of a checkout:
 *
 * - The Git top folder: the root of the Git worktree. The Git calls, the worktrees, the diffs, the turns and the
 *   Changes tab use it, and their paths are relative to it.
 * - The workspace folder: the Bun workspace of the project (for example `frontend/web` of a repository). The dev
 *   servers, the terminals, the file watcher, the file maps of the plugins, the promote and the scene saves use it,
 *   and the paths that Claude sees are relative to it. It is the "checkout" of the other host modules.
 * - The project folder: the folder with `scenity.project.json`. The runs start there.
 *
 * The workspace folder is the same sub-folder in each worktree of the repository: `rel` is its path from the Git top.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** True when the folder has a package.json with a `workspaces` field (the root of a Bun workspace). */
function isWorkspaceRoot(folder: string): boolean {
  const file = join(folder, "package.json");
  if (!existsSync(file)) return false;
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as { readonly workspaces?: unknown };
    return data.workspaces !== undefined;
  } catch {
    return false;
  }
}

/** True when `child` is `parent` or a folder in it. */
export function isInside(child: string, parent: string): boolean {
  const near = relative(parent, child);
  return near === "" || (!near.startsWith("..") && !isAbsolute(near));
}

/**
 * The workspace folder of a project folder: the first folder from `start` up to `limit` (both included) with a
 * package.json workspace, else `limit`. `limit` is the Git top folder, or the start folder with no Git.
 */
export function findWorkspace(start: string, limit: string): string {
  if (!isInside(start, limit)) return limit;
  for (let dir = start; ; dir = dirname(dir)) {
    if (isWorkspaceRoot(dir)) return dir;
    if (dir === limit || dirname(dir) === dir) return limit;
  }
}

/** The path of a folder from another folder, with `/` ("" for the same folder). */
export function slashPath(from: string, to: string): string {
  const near = relative(from, to);
  return near === "" ? "" : near.split(sep).join("/");
}

/** The Git top folder of a workspace folder: the workspace folder without the last parts of `rel`. */
export function gitTopOf(workspace: string, rel: string): string {
  if (rel === "") return workspace;
  return resolve(workspace, ...rel.split("/").map(() => ".."));
}

/** The workspace folder in a worktree: the Git top folder with `rel`. */
export function workspaceIn(top: string, rel: string): string {
  return rel === "" ? top : join(top, ...rel.split("/"));
}

/**
 * A path from the Git top folder (a path of `git status`) as a path from the workspace folder. A path outside the
 * workspace starts with `../`.
 */
export function fromTop(path: string, rel: string): string {
  if (rel === "") return path;
  if (path.startsWith(`${rel}/`)) return path.slice(rel.length + 1);
  return `${rel
    .split("/")
    .map(() => "..")
    .join("/")}/${path}`;
}
