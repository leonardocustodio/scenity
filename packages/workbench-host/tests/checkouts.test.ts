// SPDX-License-Identifier: Apache-2.0
/** Tests of the checkouts on a temporary Git repository with worktrees. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createCheckout,
  findCheckout,
  listCheckouts,
  parseWorktreeList,
  worktreeFolderName,
  worktreeRoot,
} from "../src/checkouts";
import { cleanup, makeRepo, rejectsWith, tempDir } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

let parent = "";
let repo = "";
const elsewhere = tempDir("elsewhere");

beforeAll(async () => {
  ({ parent, repo } = await makeRepo());
});
afterAll(() => cleanup(parent, elsewhere));

describe("the worktree list", () => {
  test("the porcelain output parses", () => {
    const text = [
      "worktree /r",
      "HEAD abc",
      "branch refs/heads/main",
      "",
      "worktree /r-x",
      "HEAD def",
      "detached",
      "",
      "worktree /bare",
      "bare",
      "",
    ].join("\n");
    expect(parseWorktreeList(text)).toEqual([
      { path: "/r", head: "abc", branch: "main", bare: false },
      { path: "/r-x", head: "def", branch: null, bare: false },
      { path: "/bare", head: "", branch: null, bare: true },
    ]);
  });

  test("the folder name of a branch", () => {
    expect(worktreeFolderName("scenity", "lc/room3d sdk")).toBe("scenity-lc-room3d-sdk");
  });
});

describe("the checkouts of a repository", () => {
  test("the repository has one checkout with its changed files", async () => {
    expect(await worktreeRoot(join(repo))).toBe(repo);
    writeFileSync(join(repo, "new.txt"), "x");
    const list = await listCheckouts(repo, new Set([repo]));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ path: repo, branch: "main", changed: 1, open: true });
  });

  test("a new branch gets a sibling worktree", async () => {
    const checkout = await createCheckout(repo, { branch: "feature/one" });
    expect(checkout).toMatchObject({ path: join(parent, "repo-feature-one"), branch: "feature/one", changed: 0 });
    const list = await listCheckouts(repo);
    expect(list.map((item) => item.branch)).toEqual(["main", "feature/one"]);
    expect(await worktreeRoot(checkout.path)).toBe(checkout.path);
  });

  test("an existing branch gets a worktree under the named folder", async () => {
    await Bun.$`git -C ${repo} branch two`.quiet();
    const checkout = await createCheckout(repo, { branch: "two", parent: elsewhere });
    expect(checkout.path).toBe(join(elsewhere, "repo-two"));
    expect(checkout.branch).toBe("two");
  });

  test("a bad request fails", async () => {
    await rejectsWith(createCheckout(repo, { branch: "-x" }), "cannot start");
    await rejectsWith(createCheckout(repo, { branch: "bad..name" }), "not valid");
    await rejectsWith(createCheckout(repo, { branch: "feature/one" }), "exists already");
    await rejectsWith(createCheckout(repo, { branch: "three", parent: "relative" }), "absolute");
  });

  test("open accepts only a worktree of the repository", async () => {
    const found = await findCheckout(repo, join(parent, "repo-feature-one"));
    expect(found.branch).toBe("feature/one");
    await rejectsWith(findCheckout(repo, elsewhere), "not a worktree");
    await rejectsWith(findCheckout(repo, "repo"), "absolute");
  });
});
