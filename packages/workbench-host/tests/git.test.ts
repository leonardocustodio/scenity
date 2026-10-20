// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the Git of the workbench: the allowlist, the status parser, the
 * diff with new files, the paths of the checkout and the denylist, and a commit of named files with one subject line.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../src/exec";
import {
  checkoutPath,
  checkSubject,
  gitCommit,
  gitDiff,
  gitStatus,
  headCommit,
  parseStatus,
  runGit,
  showFile,
} from "../src/git";
import { cleanup, makeRepo, rejectsWith } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const made: string[] = [];
afterAll(() => cleanup(...made));

async function repo(): Promise<string> {
  const { parent, repo: path } = await makeRepo();
  made.push(parent);
  return path;
}

describe("the allowlist", () => {
  test("it refuses the commands that change the history or throw away work", async () => {
    for (const command of ["push", "reset", "checkout", "stash", "clean", "rebase", "restore", "switch"]) {
      await rejectsWith(runGit("/", [command]), "does not run");
    }
  });
});

describe("the status", () => {
  test("it reads porcelain v2: the branch, the head, changes, a rename and untracked files", () => {
    const text = [
      "# branch.oid 0123abcd",
      "# branch.head main",
      "1 .M N... 100644 100644 100644 aaa bbb src/a file.ts",
      "2 R. N... 100644 100644 100644 aaa bbb R100 new.ts",
      "old.ts",
      "? notes/new.md",
      "? config/.env",
      "",
    ].join("\0");
    expect(parseStatus(text)).toEqual({
      branch: "main",
      head: "0123abcd",
      files: [
        { status: " M", path: "src/a file.ts" },
        { status: "R ", path: "new.ts" },
        { status: "??", path: "notes/new.md" },
      ],
    });
  });

  test("a detached head and a repository without a commit give null", () => {
    expect(parseStatus("# branch.oid (initial)\0# branch.head (detached)\0")).toEqual({
      branch: null,
      head: null,
      files: [],
    });
  });

  test("a real checkout lists each untracked file and its changes", async () => {
    const path = await repo();
    writeFileSync(join(path, "README.md"), "changed\n");
    mkdirSync(join(path, "deep", "er"), { recursive: true });
    writeFileSync(join(path, "deep", "er", "new.txt"), "new\n");
    const status = await gitStatus(path);
    expect(status.branch).toBe("main");
    expect(status.head).toBe((await headCommit(path)) ?? "");
    expect(status.files).toEqual([
      { status: " M", path: "README.md" },
      { status: "??", path: "deep/er/new.txt" },
    ]);
  });
});

describe("the paths", () => {
  test("a path must be in the checkout, outside the Git folder and outside the denylist", () => {
    expect(checkoutPath("/repo", "/repo/a/b.ts")).toBe("a/b.ts");
    expect(checkoutPath("/repo", "a/../c.ts")).toBe("c.ts");
    expect(() => checkoutPath("/repo", "/etc/passwd")).toThrow("not in the checkout");
    expect(() => checkoutPath("/repo", "../x")).toThrow("not in the checkout");
    expect(() => checkoutPath("/repo", ".git/config")).toThrow("Git folder");
    expect(() => checkoutPath("/repo", "config/.env")).toThrow("does not touch");
  });
});

describe("the diff", () => {
  test("it has the changes against HEAD and the new files; paths limit it", async () => {
    const path = await repo();
    writeFileSync(join(path, "README.md"), "test\nmore\n");
    writeFileSync(join(path, "new.txt"), "hello\n");
    const all = await gitDiff(path);
    expect(all).toContain("+more");
    expect(all).toContain("new file mode");
    expect(all).toContain("+hello");
    const one = await gitDiff(path, ["new.txt"]);
    expect(one).toContain("+hello");
    expect(one).not.toContain("+more");
    await rejectsWith(gitDiff(path, ["/etc/hosts"]), "not in the checkout");
  });
});

describe("the commit", () => {
  test("the subject must be one line without a trailer", () => {
    expect(checkSubject("  Fix the hat hand  ")).toBe("Fix the hat hand");
    expect(() => checkSubject("")).toThrow("empty");
    expect(() => checkSubject("Fix\n\nBody")).toThrow("one subject line");
    expect(() => checkSubject("Fix Co-Authored-By: Claude")).toThrow("attribution");
    expect(() => checkSubject("x".repeat(201))).toThrow("200");
  });

  test("it commits only the named files, with the subject line only", async () => {
    const path = await repo();
    writeFileSync(join(path, "README.md"), "changed\n");
    writeFileSync(join(path, "new.txt"), "new\n");
    writeFileSync(join(path, "staged.txt"), "staged\n");
    await git(path, ["add", "staged.txt"]);
    const commit = await gitCommit(path, "Add the new file", ["new.txt"]);
    expect(commit).toBe((await headCommit(path)) ?? "");
    expect(await git(path, ["log", "-1", "--format=%B"])).toBe("Add the new file\n\n");
    expect(await git(path, ["show", "--name-only", "--format=", "HEAD"])).toBe("new.txt\n");
    const status = await gitStatus(path);
    expect(status.files).toEqual([
      { status: " M", path: "README.md" },
      { status: "A ", path: "staged.txt" },
    ]);
    expect((await showFile(path, commit, "new.txt"))?.toString()).toBe("new\n");
    expect(await showFile(path, commit, "missing.txt")).toBeNull();
    await rejectsWith(gitCommit(path, "Nothing", []), "at least one file");
  });
});
