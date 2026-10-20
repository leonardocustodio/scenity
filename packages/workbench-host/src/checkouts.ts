// SPDX-License-Identifier: Apache-2.0
/**
 * The checkouts of the repository: the Git worktrees. The host lists them, makes
 * one from a branch and opens one. A checkout is always a worktree of the repository of the checkout that the host
 * started with.
 *
 * Git is optional. A folder with no Git is its one checkout: no branch, no worktrees, no changes count.
 *
 * A checkout is the workspace folder in a worktree (workspace.ts). `rel` is the path of the workspace folder
 * from the Git top folder ("" when they are the same). Each worktree of the repository has its workspace at `rel`.
 */
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
// Every Git call of the start screen goes through the allowlist of git.ts.
import { hostGit as git } from "./git";
import { NO_GIT, type Checkout } from "./protocol";
import { workspaceIn } from "./workspace";

/** One entry of `git worktree list --porcelain`. */
export interface Worktree {
  readonly path: string;
  readonly head: string;
  /** The short branch name, or null for a detached HEAD. */
  readonly branch: string | null;
  readonly bare: boolean;
}

/** Read the output of `git worktree list --porcelain`. The first entry is the main worktree. */
export function parseWorktreeList(text: string): Worktree[] {
  const list: Worktree[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    let path: string | null = null;
    let head = "";
    let branch: string | null = null;
    let bare = false;
    for (const line of block.split("\n")) {
      const space = line.indexOf(" ");
      const key = space < 0 ? line : line.slice(0, space);
      const value = space < 0 ? "" : line.slice(space + 1);
      if (key === "worktree") path = value;
      else if (key === "HEAD") head = value;
      else if (key === "branch") branch = value.replace(/^refs\/heads\//, "");
      else if (key === "bare") bare = true;
    }
    if (path !== null) list.push({ path, head, branch, bare });
  }
  return list;
}

/** The top folder of the worktree that holds the given folder. */
export async function worktreeRoot(folder: string): Promise<string> {
  return realpathSync((await git(folder, ["rev-parse", "--show-toplevel"])).trim());
}

/** The top folder of the Git worktree that holds the folder, or null for a folder with no Git. */
export async function gitRoot(folder: string): Promise<string | null> {
  try {
    return await worktreeRoot(folder);
  } catch {
    return null;
  }
}

/** The one checkout of a folder with no Git. */
function plainCheckout(path: string, open: ReadonlySet<string>): Checkout {
  return { path, branch: null, head: "", changed: 0, open: open.has(path) };
}

/** The worktrees of the repository of the given checkout, without a bare repository. */
export async function listWorktrees(repo: string): Promise<Worktree[]> {
  const list = parseWorktreeList(await git(repo, ["worktree", "list", "--porcelain"]));
  return list.filter((item) => !item.bare);
}

/** The count of changed files of a worktree (`git status --porcelain`). */
export async function countChanged(path: string): Promise<number> {
  const text = await git(path, ["status", "--porcelain", "--untracked-files=normal"]);
  return text.split("\n").filter((line) => line.trim() !== "").length;
}

/** The checkout of a worktree: its workspace folder at `rel`. */
async function toCheckout(item: Worktree, open: ReadonlySet<string>, rel: string): Promise<Checkout> {
  const path = workspaceIn(item.path, rel);
  const changed = existsSync(path) ? await countChanged(path) : 0;
  return { path, branch: item.branch, head: item.head, changed, open: open.has(path) };
}

/**
 * The checkouts of the repository of `repo` (a workspace folder of it). `open` holds the paths of the checkouts that
 * the host has open. `rel` is the workspace folder from the Git top folder.
 */
export async function listCheckouts(
  repo: string,
  open: ReadonlySet<string> = new Set(),
  hasGit = true,
  rel = "",
): Promise<Checkout[]> {
  if (!hasGit) return [plainCheckout(repo, open)];
  const list = await listWorktrees(repo);
  return Promise.all(list.map((item) => toCheckout(item, open, rel)));
}

function samePath(a: string, b: string): boolean {
  const real = (path: string): string => (existsSync(path) ? realpathSync(path) : resolve(path));
  return real(a) === real(b);
}

/**
 * The checkout of the repository at the given path. Throw an error when the path is not the workspace folder of a
 * worktree of it (the folder at `rel` in the worktree).
 */
export async function findCheckout(
  repo: string,
  path: string,
  open: ReadonlySet<string> = new Set(),
  hasGit = true,
  rel = "",
): Promise<Checkout> {
  if (!isAbsolute(path)) throw new Error(`The checkout path must be absolute: ${path}`);
  if (!hasGit) {
    if (!samePath(repo, path)) throw new Error(`The path is not the project folder: ${path}`);
    return plainCheckout(repo, open);
  }
  const item = (await listWorktrees(repo)).find((worktree) => samePath(workspaceIn(worktree.path, rel), path));
  if (item === undefined) {
    const where = rel === "" ? "a worktree" : `the folder ${rel} of a worktree`;
    throw new Error(`The path is not ${where} of the repository: ${path}`);
  }
  return toCheckout(item, open, rel);
}

/** The folder name of a new worktree: `<repository name>-<branch>`, with each unsafe character as `-`. */
export function worktreeFolderName(repoName: string, branch: string): string {
  return `${repoName}-${branch.replace(/[^A-Za-z0-9._-]+/g, "-")}`;
}

/** Check a branch name with `git check-ref-format --branch`. Throw an error for a bad name. */
async function checkBranch(repo: string, branch: string): Promise<void> {
  if (branch.startsWith("-")) throw new Error(`A branch name cannot start with "-": ${branch}`);
  await git(repo, ["check-ref-format", "--branch", branch]).catch(() => {
    throw new Error(`The branch name is not valid: ${branch}`);
  });
}

async function branchExists(repo: string, branch: string): Promise<boolean> {
  return git(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).then(
    () => true,
    () => false,
  );
}

export interface CreateOptions {
  readonly branch: string;
  /** The start point of a new branch. The default is the HEAD of `repo`. */
  readonly base?: string | undefined;
  /** The parent folder of the new worktree. The default is the parent folder of the main worktree. */
  readonly parent?: string | undefined;
}

/**
 * Make a worktree of a branch. An existing branch gets a worktree as it is; a new branch starts at `base`. The
 * folder is `<parent>/<repository name>-<branch>` and must not exist. The checkout is the workspace folder at
 * `rel` in the new worktree; the branch must have that folder.
 */
export async function createCheckout(repo: string, options: CreateOptions, hasGit = true, rel = ""): Promise<Checkout> {
  if (!hasGit) throw new Error(NO_GIT);
  await checkBranch(repo, options.branch);
  if (options.base?.startsWith("-") === true) throw new Error(`The base cannot start with "-": ${options.base}`);
  const main = (await listWorktrees(repo))[0];
  if (main === undefined) throw new Error("The repository has no worktree.");
  const parent = options.parent ?? dirname(main.path);
  if (!isAbsolute(parent)) throw new Error(`The parent folder must be absolute: ${parent}`);
  const path = join(parent, worktreeFolderName(basename(main.path), options.branch));
  if (existsSync(path)) throw new Error(`The folder exists already: ${path}`);
  const args = (await branchExists(repo, options.branch))
    ? ["worktree", "add", path, options.branch]
    : ["worktree", "add", "-b", options.branch, path, options.base ?? "HEAD"];
  await git(repo, args);
  const workspace = workspaceIn(path, rel);
  if (!existsSync(workspace)) throw new Error(`The new worktree ${path} has no folder ${rel}.`);
  return findCheckout(repo, workspace, new Set(), true, rel);
}
