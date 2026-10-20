// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the denylist and of the Git allowlist. `.env*` files, keys and the files of a state folder never show in
 * the diff view, the run file route, the packet or a file tool. The Git allowlist of the host and the Git guard of the
 * hooks agree.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { limitLines } from "../src/context";
import { allowedPaths, denyFolder, isDenied, withoutDenied } from "../src/denylist";
import { git } from "../src/exec";
import { GIT_ALLOWLIST, gitDiff, gitStatus, hostGit, hostGitRefusal, runGit } from "../src/git";
import { GUARDED_SUBCOMMANDS, gitArgsRefusal, gitRefusal } from "../src/gitGuard";
import { RunManager, type RunExit, type RunSpawner } from "../src/runs";
import { WEB_DIR } from "../src/runArgs";
import { HostState } from "../src/state";
import { cleanup, makeRepo, rejectsWith, tempDir } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";
import { useLabFixture } from "./labFixture";

// The built-in project of the host is the lab fixture (a lab surface, the `labs` runs, the stop gate).
useLabFixture();

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const folders: string[] = [];
afterAll(() => cleanup(...folders));

describe("the denylist", () => {
  test("env files, keys and state folders are denied; source files are not", () => {
    for (const path of [
      "config/.env",
      ".env",
      ".env.local",
      ".envrc",
      "/Users/x/repo/config/.env",
      "infra/tls/server.pem",
      "keys/deploy.key",
      "home/.ssh/id_ed25519",
      "home/.ssh/id_rsa.pub",
      "/Users/x/Library/Application Support/org.scenity.editor/host/abc/claude/settings.json",
      // The folder of the old app ID stays on the denylist.
      "/Users/x/Library/Application Support/org.codeblue.labs/host/abc/claude/settings.json",
    ]) {
      expect([path, isDenied(path)]).toEqual([path, true]);
    }
    for (const path of [
      "plugins/demo/room/src/families/wave.ts",
      "docs/environment.md",
      "engine/README.md",
      "apps/editor/src/core/keys.ts",
    ]) {
      expect([path, isDenied(path)]).toEqual([path, false]);
    }
  });

  test("a state folder of a host is denied after its start", () => {
    const dir = tempDir("deny-state");
    folders.push(dir);
    const state = join(dir, "state");
    expect(isDenied(join(state, "claude", "settings.json"))).toBe(false);
    new HostState(state);
    expect(isDenied(join(state, "claude", "settings.json"))).toBe(true);
    denyFolder(join(dir, "other"));
    expect(isDenied(join(dir, "other"))).toBe(true);
  });

  test("the packet and a file tool leave out a line that names a denied file", () => {
    const lines = ["Checkout: /co (main)", "Changed files: config/.env, a.ts.", "Tools: lab_frame"];
    expect(withoutDenied(lines)).toEqual(["Checkout: /co (main)", "Tools: lab_frame"]);
    expect(limitLines(lines)).toEqual(["Checkout: /co (main)", "Tools: lab_frame"]);
    expect(allowedPaths(["a.ts", "config/.env", "b/.env.prod"])).toEqual(["a.ts"]);
  });

  test("the status, the diff and the Git paths never show config/.env", async () => {
    const { parent, repo } = await makeRepo();
    folders.push(parent);
    mkdirSync(join(repo, "config"), { recursive: true });
    writeFileSync(join(repo, "config", ".env"), "SCENITY_SECRET=do-not-show\n");
    writeFileSync(join(repo, "config", "app.ts"), "export const a = 1;\n");
    const status = await gitStatus(repo);
    expect(status.files.map((file) => file.path)).toEqual(["config/app.ts"]);
    const patch = await gitDiff(repo);
    expect(patch).toContain("config/app.ts");
    expect(patch).not.toContain("do-not-show");
    await rejectsWith(gitDiff(repo, ["config/.env"]), "does not touch");
  });

  test("the run file route never serves a denied file of an output folder", async () => {
    const dir = tempDir("deny-runs");
    folders.push(dir);
    const checkout = join(dir, "checkout");
    mkdirSync(join(checkout, WEB_DIR), { recursive: true });
    let end: (exit: RunExit) => void = () => undefined;
    const spawn: RunSpawner = () => ({
      exited: new Promise<RunExit>((resolve) => (end = resolve)),
      signal: () => undefined,
    });
    const runs = new RunManager({ emit: () => undefined, spawn });
    const { run, done } = runs.start(checkout, "shot", []);
    const outDir = runs.info(run)?.outDir ?? "";
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "a.png"), "png");
    writeFileSync(join(outDir, ".env"), "SECRET=1");
    writeFileSync(join(outDir, "cert.pem"), "key");
    end({ code: 0, signal: null });
    await done;
    expect(runs.fileOf(run, "a.png")).toBe(join(outDir, "a.png"));
    expect(runs.fileOf(run, ".env")).toBeNull();
    expect(runs.fileOf(run, "cert.pem")).toBeNull();
  });
});

/** A typical call of each subcommand of the allowlist, as the host makes it. */
const HOST_CALLS: Readonly<Record<(typeof GIT_ALLOWLIST)[number], readonly string[]>> = {
  status: ["status", "--porcelain=v2", "--branch", "-z"],
  diff: ["diff", "--no-color", "HEAD", "--", "a.ts"],
  add: ["add", "--", "a.ts"],
  commit: ["commit", "--quiet", "-m", "Change", "--", "a.ts"],
  "rev-parse": ["rev-parse", "--show-toplevel"],
  show: ["show", "HEAD:a.ts"],
  "cat-file": ["cat-file", "-e", "HEAD:a.ts"],
  "check-ignore": ["check-ignore", "--quiet", "--", "a.ts"],
  log: ["log", "--oneline", "-5"],
  worktree: ["worktree", "list", "--porcelain"],
  "check-ref-format": ["check-ref-format", "--branch", "lc/x"],
  "show-ref": ["show-ref", "--verify", "--quiet", "refs/heads/lc/x"],
};

describe("the Git allowlist and the Git guard", () => {
  test("each call of the allowlist passes the host check and the hook guard", () => {
    for (const command of GIT_ALLOWLIST) {
      const args = HOST_CALLS[command];
      expect([command, hostGitRefusal(args)]).toEqual([command, null]);
      expect([command, gitRefusal(`git ${args.join(" ")}`)]).toEqual([command, null]);
    }
  });

  test("a call that the guard refuses is refused by the host too", () => {
    for (const sub of GUARDED_SUBCOMMANDS) {
      const allowed = (GIT_ALLOWLIST as readonly string[]).includes(sub);
      // The guard refuses a push, a rebase and the other history changes; only `commit` is on both lists.
      expect([sub, allowed]).toEqual([sub, sub === "commit"]);
    }
    expect(gitArgsRefusal(["commit", "--amend", "-m", "x"])).not.toBeNull();
    expect(hostGitRefusal(["commit", "--amend", "-m", "x"])).toContain("commit --amend");
    expect(hostGitRefusal(["push", "origin"])).toContain('"git push"');
    expect(hostGitRefusal(["worktree", "remove", "/x"])).toContain("worktree remove");
    expect(hostGitRefusal(["stash"])).toContain('"git stash"');
  });

  test("runGit and hostGit refuse before they start Git", async () => {
    const { parent, repo } = await makeRepo();
    folders.push(parent);
    await rejectsWith(runGit(repo, ["reset", "--hard"]), "does not run");
    await rejectsWith(runGit(repo, ["commit", "--amend", "-m", "x"]), "commit --amend");
    await rejectsWith(hostGit(repo, ["worktree", "prune"]), "worktree prune");
    expect((await hostGit(repo, ["rev-parse", "--show-toplevel"])).trim()).toBe(repo);
    // The test helper itself runs Git without the allowlist (exec.ts).
    expect((await git(repo, ["config", "user.name"])).trim()).toBe("Test");
  });
});
