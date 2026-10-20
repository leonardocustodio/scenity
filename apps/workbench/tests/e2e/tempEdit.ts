// SPDX-License-Identifier: Apache-2.0
/**
 * A temporary edit of a source file of the checkout for the workbench end-to-end tests. The test changes a runtime
 * file so that the dev server applies it, then writes the original bytes back. A run never leaves a runtime file
 * changed, and it never puts uncommitted work of the owner at risk:
 *
 * - A file that Git tracks must be clean in Git before the edit. The restore checks that Git sees no change of the file
 *   (`git diff --quiet`). After a stopped run, Git holds the original bytes.
 * - A file that Git does not track (a new file of the owner, not committed) has no copy in Git. Before it writes, the
 *   edit keeps a copy of the original bytes outside the checkout (`backupDir`). The restore compares the bytes with
 *   that copy. A copy that a stopped run left blocks the next edit of the file until the owner examines it. Thus the
 *   test never writes over the only copy of the original.
 * - The edit refuses a file that Git ignores: the test edits only source files.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** True when Git sees no change of the file (in the index and in the working tree). */
export function cleanInGit(checkout: string, path: string): boolean {
  const worktree = spawnSync("git", ["-C", checkout, "diff", "--quiet", "--", path]);
  const index = spawnSync("git", ["-C", checkout, "diff", "--quiet", "--cached", "--", path]);
  return worktree.status === 0 && index.status === 0;
}

/** True when Git tracks the file (it is in the index). */
export function trackedInGit(checkout: string, path: string): boolean {
  return spawnSync("git", ["-C", checkout, "ls-files", "--error-unmatch", "--", path]).status === 0;
}

/** True when Git ignores the file. */
function ignoredInGit(checkout: string, path: string): boolean {
  return spawnSync("git", ["-C", checkout, "check-ignore", "--quiet", "--", path]).status === 0;
}

/** The folder of the copies of the files that Git does not track, outside each checkout. */
export function backupDir(): string {
  return join(tmpdir(), "scenity-workbench-e2e-edits");
}

/** The copy of the original bytes of a file that Git does not track. */
function backupOf(file: string): string {
  return join(backupDir(), `${createHash("sha256").update(file).digest("hex").slice(0, 24)}.orig`);
}

export interface TempEdit {
  /** The absolute path of the file. */
  readonly file: string;
  /** Write the changed text. */
  apply(): void;
  /** Write the original bytes back; throw when the file is not the same as before. Twice is harmless. */
  restore(): void;
}

/** The check of the original state of the file: Git for a tracked file, the kept copy for a new file. */
function originalCheck(checkout: string, path: string, file: string, original: Buffer): () => boolean {
  if (trackedInGit(checkout, path)) {
    if (!cleanInGit(checkout, path)) throw new Error(`${path} has changes in Git; the test edits only a clean file.`);
    return () => cleanInGit(checkout, path);
  }
  if (ignoredInGit(checkout, path)) throw new Error(`Git ignores ${path}; the test edits only a source file.`);
  const backup = backupOf(file);
  if (existsSync(backup)) {
    throw new Error(
      `A stopped run left the original bytes of ${path} in ${backup}. Compare the file with it, then remove the copy.`,
    );
  }
  const hash = createHash("sha256").update(original).digest("hex");
  return () => createHash("sha256").update(readFileSync(file)).digest("hex") === hash;
}

/**
 * Prepare a temporary edit of a file of the checkout. Throw when a tracked file has changes already, when Git ignores
 * the file, or when a copy of a stopped run exists.
 */
export function tempEdit(checkout: string, path: string, change: (text: string) => string): TempEdit {
  const file = resolve(checkout, path);
  const original = readFileSync(file);
  const same = originalCheck(checkout, path, file, original);
  const tracked = trackedInGit(checkout, path);
  const changed = change(original.toString("utf8"));
  if (changed === original.toString("utf8")) throw new Error(`The change of ${path} changes nothing.`);
  let applied = false;
  return {
    file,
    apply() {
      if (!tracked) {
        mkdirSync(backupDir(), { recursive: true, mode: 0o700 });
        writeFileSync(backupOf(file), original, { mode: 0o600 });
      }
      writeFileSync(file, changed);
      applied = true;
    },
    restore() {
      if (!applied) return;
      writeFileSync(file, original);
      applied = false;
      if (!same()) throw new Error(`${path} is not the same as before the edit after the restore.`);
      if (!tracked) rmSync(backupOf(file), { force: true });
    },
  };
}
