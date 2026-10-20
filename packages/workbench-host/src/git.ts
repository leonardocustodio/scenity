// SPDX-License-Identifier: Apache-2.0
/**
 * The Git of the workbench: a short allowlist of Git commands for the
 * Changes tab and the turns. The host reads the status and the diff, stages named files and commits them with one
 * subject line. It never pushes, never resets, never checks out and never stashes. A program gets no shell: the
 * arguments go to Git as they are.
 */
import { spawn } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { isDenied } from "./denylist";
import { git } from "./exec";
import { gitArgsRefusal } from "./gitGuard";
import type { ChangedFile } from "./protocol";

/**
 * The Git subcommands that the host can run. Every other subcommand is an error. The worktree commands
 * of the start screen (checkouts.ts) are `worktree list` and `worktree add` only. A call that the Git guard of the
 * hooks refuses (gitGuard.ts: `commit --amend`, a push, a reset, …) is also an error, so the host and Claude agree.
 */
export const GIT_ALLOWLIST = [
  "status",
  "diff",
  "add",
  "commit",
  "rev-parse",
  "show",
  "cat-file",
  "check-ignore",
  "log",
  "worktree",
  "check-ref-format",
  "show-ref",
] as const;
export type GitCommand = (typeof GIT_ALLOWLIST)[number];

/** The `git worktree` subcommands of the allowlist. */
export const GIT_WORKTREE_ALLOWLIST = ["list", "add"] as const;

/** The reason to refuse a Git call of the host (the arguments without `git`), or null when it may run. */
export function hostGitRefusal(args: readonly string[]): string | null {
  const command = args[0] ?? "";
  if (!(GIT_ALLOWLIST as readonly string[]).includes(command)) return `The workbench does not run "git ${command}".`;
  if (command === "worktree" && !(GIT_WORKTREE_ALLOWLIST as readonly string[]).includes(args[1] ?? "")) {
    return `The workbench does not run "git worktree ${args[1] ?? ""}".`;
  }
  const guarded = gitArgsRefusal(args);
  return guarded === null ? null : `The workbench does not run ${guarded}.`;
}

/** Run a Git call of the allowlist with exec.ts (the checkouts, the packet). Give its stdout; throw on a failure. */
export function hostGit(cwd: string, args: readonly string[]): Promise<string> {
  const refusal = hostGitRefusal(args);
  return refusal === null ? git(cwd, args) : Promise.reject(new Error(refusal));
}

/** The output of a Git command as bytes. */
export interface GitOutput {
  readonly code: number | null;
  readonly stdout: Buffer;
  readonly stderr: string;
}

/** Files that the workbench never shows or reads: denylist.ts. */
export { isDenied } from "./denylist";

/**
 * Run a Git command of the allowlist in a folder. `ok` lists the exit codes that are not an error (default 0).
 * The promise rejects with the text of stderr for another code.
 */
export function runGit(cwd: string, args: readonly string[], ok: readonly number[] = [0]): Promise<GitOutput> {
  const command = args[0] ?? "";
  const refusal = hostGitRefusal(args);
  if (refusal !== null) return Promise.reject(new Error(refusal));
  return new Promise((done, fail) => {
    // No optional locks: a status of the host must not block a Git command of the owner.
    const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat" };
    const child = spawn("git", ["-c", "core.quotepath=false", ...args], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", fail);
    child.on("close", (code) => {
      const stderr = Buffer.concat(err).toString("utf8");
      if (code === null || !ok.includes(code)) {
        fail(new Error(`git ${command}: ${stderr.trim() || `exit code ${String(code)}`}`));
        return;
      }
      done({ code, stdout: Buffer.concat(out), stderr });
    });
  });
}

/** Run a Git command of the allowlist and give its stdout as text. */
export async function gitText(cwd: string, args: readonly string[], ok?: readonly number[]): Promise<string> {
  return (await runGit(cwd, args, ok)).stdout.toString("utf8");
}

/**
 * Make a path relative to the checkout (with `/` separators). Throw an error for a path outside the checkout, for a
 * path of the `.git` folder and for a path of the denylist.
 */
export function checkoutPath(checkout: string, path: string): string {
  const full = isAbsolute(path) ? resolve(path) : resolve(checkout, path);
  const near = relative(checkout, full);
  if (near === "" || near.startsWith("..") || isAbsolute(near)) {
    throw new Error(`The path is not in the checkout: ${path}`);
  }
  const posix = near.split(sep).join("/");
  if (posix === ".git" || posix.startsWith(".git/")) throw new Error(`The path is in the Git folder: ${path}`);
  if (isDenied(posix)) throw new Error(`The workbench does not touch this file: ${posix}`);
  return posix;
}

/** The status of a checkout. */
export interface GitStatus {
  readonly branch: string | null;
  readonly head: string | null;
  readonly files: ChangedFile[];
}

/** The two-letter code of porcelain v1 from the `XY` field of porcelain v2 (`.` is a space). */
function code(xy: string): string {
  return xy.replaceAll(".", " ");
}

/** Read the output of `git status --porcelain=v2 --branch -z`. */
export function parseStatus(text: string): GitStatus {
  const parts = text.split("\0");
  let branch: string | null = null;
  let head: string | null = null;
  const files: ChangedFile[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index] ?? "";
    if (entry.startsWith("# branch.head ")) {
      const name = entry.slice("# branch.head ".length);
      branch = name === "(detached)" ? null : name;
    } else if (entry.startsWith("# branch.oid ")) {
      const oid = entry.slice("# branch.oid ".length);
      head = oid === "(initial)" ? null : oid;
    } else if (entry.startsWith("1 ")) {
      files.push({ status: code(entry.slice(2, 4)), path: entry.split(" ").slice(8).join(" ") });
    } else if (entry.startsWith("2 ")) {
      // A rename or a copy: the next part is the old path.
      files.push({ status: code(entry.slice(2, 4)), path: entry.split(" ").slice(9).join(" ") });
      index += 1;
    } else if (entry.startsWith("u ")) {
      files.push({ status: code(entry.slice(2, 4)), path: entry.split(" ").slice(10).join(" ") });
    } else if (entry.startsWith("? ")) {
      files.push({ status: "??", path: entry.slice(2) });
    }
  }
  return { branch, head, files: files.filter((file) => !isDenied(file.path)) };
}

/** The status of a checkout: the branch, the HEAD commit and each changed file (untracked files one by one). */
export async function gitStatus(checkout: string): Promise<GitStatus> {
  const text = await gitText(checkout, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]);
  return parseStatus(text);
}

/** The commit of HEAD, or null in a repository without a commit. */
export async function headCommit(checkout: string): Promise<string | null> {
  const text = await gitText(checkout, ["rev-parse", "--verify", "--quiet", "HEAD"], [0, 1]);
  return text.trim() === "" ? null : text.trim();
}

/** The content of a file at a commit, or null when the commit has no such file. */
export async function showFile(checkout: string, commit: string, path: string): Promise<Buffer | null> {
  const spec = `${commit}:${path}`;
  const exists = await runGit(checkout, ["cat-file", "-e", spec], [0, 1, 128]);
  if (exists.code !== 0) return null;
  return (await runGit(checkout, ["show", spec])).stdout;
}

/** True when Git ignores the path. */
export async function isIgnored(checkout: string, path: string): Promise<boolean> {
  return (await runGit(checkout, ["check-ignore", "--quiet", "--", path], [0, 1])).code === 0;
}

/** The longest diff that the host gives the page (bytes). */
export const MAX_PATCH = 2_000_000;

/**
 * The unified diff of changed files against HEAD; untracked files show as new files. `paths` limits the diff to
 * those files (relative to the checkout); without it the diff has every changed file.
 */
export async function gitDiff(checkout: string, paths?: readonly string[]): Promise<string> {
  const status = await gitStatus(checkout);
  const wanted = paths === undefined ? null : new Set(paths.map((path) => checkoutPath(checkout, path)));
  const files = status.files.filter((file) => wanted === null || wanted.has(file.path));
  const tracked = files.filter((file) => file.status !== "??").map((file) => file.path);
  const untracked = files.filter((file) => file.status === "??").map((file) => file.path);
  const flags = ["--no-color", "--no-ext-diff", "--no-textconv"];
  const parts: string[] = [];
  if (tracked.length > 0) {
    const base = status.head === null ? [] : ["HEAD"];
    parts.push(await gitText(checkout, ["diff", ...flags, ...base, "--", ...tracked]));
  }
  for (const path of untracked) {
    if (parts.join("").length > MAX_PATCH) break;
    // `--no-index` gives exit code 1 when the files differ, and it always differs from /dev/null.
    parts.push(await gitText(checkout, ["diff", ...flags, "--no-index", "--", "/dev/null", path], [0, 1]));
  }
  const patch = parts.join("");
  return patch.length > MAX_PATCH ? `${patch.slice(0, MAX_PATCH)}\n… (the diff is longer; it stops here)\n` : patch;
}

/** Words of an attribution line, which a commit of the workbench must not have (the repository rules). */
const ATTRIBUTION = /co-authored-by|signed-off-by|generated with|🤖/i;

/** Check a commit message: one subject line, not empty, at most 200 characters, no trailer or attribution. */
export function checkSubject(message: string): string {
  const subject = message.trim();
  if (subject === "") throw new Error("The commit message is empty.");
  if (/[\r\n]/.test(subject)) throw new Error("The commit message must be one subject line, without a body.");
  if (subject.length > 200) throw new Error("The commit subject is longer than 200 characters.");
  if (ATTRIBUTION.test(subject)) throw new Error("The commit message must not have a trailer or an attribution.");
  return subject;
}

/** Stage the named files (a deleted file stages its deletion). */
export async function gitAdd(checkout: string, paths: readonly string[]): Promise<void> {
  const files = paths.map((path) => checkoutPath(checkout, path));
  if (files.length === 0) throw new Error("No file to add.");
  await runGit(checkout, ["add", "--", ...files]);
}

/**
 * Commit the named files with one subject line, and give the new commit. Other staged files stay staged and out of
 * the commit (`git commit -- <paths>` commits only the paths). The owner's Git hooks run as in a terminal.
 */
export async function gitCommit(checkout: string, message: string, paths: readonly string[]): Promise<string> {
  const subject = checkSubject(message);
  const files = paths.map((path) => checkoutPath(checkout, path));
  if (files.length === 0) throw new Error("Select at least one file to commit.");
  await gitAdd(checkout, files);
  await runGit(checkout, ["commit", "--quiet", "--cleanup=strip", "-m", subject, "--", ...files]);
  const commit = await headCommit(checkout);
  if (commit === null) throw new Error("The commit did not make a HEAD.");
  return commit;
}
