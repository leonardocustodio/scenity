// SPDX-License-Identifier: Apache-2.0
/**
 * The folder of a background task: the project folder, or a Git worktree of its repository on a branch of its own
 * (`scenity/task-<id>`). Thus the files of the task never change the folder of the person. The worktree starts at the
 * last commit (HEAD): an edit that is not committed is not in it. The gate `check` writes the scene of the window
 * after the change sets of the task into the task folder (a worktree only). Then it runs `scenity check` there: the
 * check of the project is the gate.
 */
import { mkdirSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";

/** The worktree of a task: its folder, its branch, and the project folder in it. */
export interface TaskWorktree {
  readonly dir: string;
  readonly branch: string;
  readonly project: string;
}

/** The result of a command: its exit code and its output. */
function git(dir: string, args: readonly string[]): { code: number; out: string } {
  const run = Bun.spawnSync(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" });
  const out = `${run.stdout.toString()}${run.stderr.toString()}`.trim();
  return { code: run.exitCode, out };
}

/** Make the worktree of the task `id` of a project folder under `root`. Throws when the folder has no Git. */
export function makeWorktree(projectDir: string, root: string, id: string): TaskWorktree {
  const top = git(projectDir, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) throw new Error("A task in a worktree needs a project folder in a Git repository.");
  const repo = realpathSync(top.out);
  const inside = relative(repo, realpathSync(projectDir));
  const branch = `scenity/task-${id}`;
  mkdirSync(root, { recursive: true });
  const dir = join(root, id);
  const made = git(repo, ["worktree", "add", "-b", branch, dir, "HEAD"]);
  if (made.code !== 0) throw new Error(`The worktree of the task was not made: ${made.out}`);
  return { dir, branch, project: join(dir, inside) };
}

/** The words of a check: its last lines. */
function lastLines(text: string, count = 3): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .slice(-count)
    .join(" ");
}

/** Run `scenity check` in a project folder: passed on exit 0, with the last lines of its output. */
export async function runProjectCheck(
  cli: readonly string[],
  dir: string,
): Promise<{ passed: boolean; message: string }> {
  const run = Bun.spawn([...cli, "check", dir], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
    run.exited,
  ]);
  const words = lastLines(code === 0 ? out : `${out}\n${err}`);
  return {
    passed: code === 0,
    message: code === 0 ? `scenity check passes. ${words}` : `scenity check fails: ${words}`,
  };
}
