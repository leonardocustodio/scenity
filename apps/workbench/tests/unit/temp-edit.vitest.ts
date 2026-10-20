// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
/**
 * The temporary edits of the end-to-end tests (tests/e2e/tempEdit.ts) in a temporary Git repository. A tracked file
 * must be clean. A file that Git does not track gets a copy outside the checkout while the edit lasts. A copy of a
 * stopped run blocks the next edit. The edit refuses a file that Git ignores.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { backupDir, tempEdit } from "../e2e/tempEdit";

const repo = mkdtempSync(join(tmpdir(), "workbench-temp-edit-"));
afterAll(() => rmSync(repo, { recursive: true, force: true }));

function git(...args: string[]): void {
  const result = spawnSync("git", ["-C", repo, ...args]);
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
}

git("init", "--quiet", "--initial-branch=main");
git("config", "user.email", "test@example.com");
git("config", "user.name", "Test");
git("config", "commit.gpgsign", "false");
writeFileSync(join(repo, "tracked.ts"), "export const a = 1;\n");
writeFileSync(join(repo, ".gitignore"), "ignored.ts\n");
git("add", "-A");
git("commit", "--quiet", "-m", "start");

/** The names in the folder of the copies (other runs can have copies there too). */
function copies(): string[] {
  return existsSync(backupDir()) ? readdirSync(backupDir()) : [];
}

describe("tempEdit", () => {
  test("a clean tracked file: the edit and its restore; a changed tracked file is refused", () => {
    const edit = tempEdit(repo, "tracked.ts", (text) => text.replace("1", "2"));
    edit.apply();
    expect(readFileSync(edit.file, "utf8")).toBe("export const a = 2;\n");
    edit.restore();
    expect(readFileSync(edit.file, "utf8")).toBe("export const a = 1;\n");
    writeFileSync(join(repo, "tracked.ts"), "export const a = 3;\n");
    expect(() => tempEdit(repo, "tracked.ts", (text) => `${text} `)).toThrow("has changes in Git");
    writeFileSync(join(repo, "tracked.ts"), "export const a = 1;\n");
  });

  test("a new file that Git does not track: a copy outside the checkout while the edit lasts", () => {
    writeFileSync(join(repo, "new.ts"), "export const b = 1;\n");
    const before = copies();
    const edit = tempEdit(repo, "new.ts", (text) => text.replace("1", "2"));
    edit.apply();
    const kept = copies().filter((name) => !before.includes(name));
    expect(kept).toHaveLength(1);
    expect(readFileSync(join(backupDir(), kept[0] ?? ""), "utf8")).toBe("export const b = 1;\n");
    // A second edit of the same file sees the copy of a run that did not restore it.
    expect(() => tempEdit(repo, "new.ts", (text) => `${text} `)).toThrow("A stopped run left the original bytes");
    edit.restore();
    edit.restore();
    expect(readFileSync(join(repo, "new.ts"), "utf8")).toBe("export const b = 1;\n");
    expect(copies().filter((name) => !before.includes(name))).toEqual([]);
  });

  test("a file that Git ignores is refused", () => {
    writeFileSync(join(repo, "ignored.ts"), "export const c = 1;\n");
    expect(() => tempEdit(repo, "ignored.ts", (text) => `${text} `)).toThrow("Git ignores ignored.ts");
  });
});
