// SPDX-License-Identifier: Apache-2.0
/**
 * A workspace in a sub-folder of a Git repository (the `frontend/web` of a repository). The temporary
 * repository has its Bun workspace in `web/` and the project in `web/game`.
 *
 * - The host starts from `--project web/game`, from `--checkout web` and from both: the checkout is `web`, not the Git
 *   top folder.
 * - A run starts in the project folder; the setup of a new worktree runs in its workspace folder.
 * - A new worktree is a worktree of the repository, and its checkout is the same sub-folder in it.
 * - A scene save sends a path of the workspace; the Changes tab and the turns use the paths of the Git top folder.
 * - The context packet names the changed files from the workspace folder.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "@scenity/scene";
import { gitSummary } from "../src/context";
import { changedFiles } from "../src/loopRun";
import { git } from "../src/exec";
import { startHost, type Host } from "../src/host";
import type { Checkout, RequestResult, SceneFileText, SceneSaveResult } from "../src/protocol";
import { findWorkspace, fromTop, gitTopOf, workspaceIn } from "../src/workspace";
import { scaleTestTimeouts } from "./ciTiming";
import { cleanup, fakeCommand, FakePage, makeRepo, tempDir, until } from "./helpers";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const SCENE = "scenes/main.scene.json";
const made: string[] = [];
afterAll(() => cleanup(...made));

/** A scene with the box at x. */
function scene(x: number): unknown {
  const transform = { position: [x, 0, 0.5] };
  return {
    format: "scenity.scene/1",
    id: "main",
    entities: { box: { parent: null, index: 0, components: { transform } } },
  };
}

/** A repository with the workspace in `web/` and the project in `web/game`, all committed. */
async function subfolderRepo(): Promise<{ parent: string; top: string; web: string; game: string }> {
  const { parent, repo } = await makeRepo();
  made.push(parent);
  const web = join(repo, "web");
  const game = join(web, "game");
  mkdirSync(join(game, "scenes"), { recursive: true });
  writeFileSync(join(web, "package.json"), `${JSON.stringify({ name: "web", private: true, workspaces: [] })}\n`);
  const workbench = {
    surfaces: [{ id: "editor", kind: "scene", label: "Editor" }],
    runs: { where: "pwd" },
    setup: "pwd",
  };
  const manifest = { format: "scenity.project/1", id: "game", name: "Game", scenes: [SCENE], workbench };
  writeFileSync(join(game, "scenity.project.json"), canonicalJson(manifest));
  writeFileSync(join(game, SCENE), canonicalJson(scene(1)));
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "--quiet", "-m", "web"]);
  return { parent, top: repo, web, game };
}

async function start(checkout: string, project?: string): Promise<{ host: Host; page: FakePage }> {
  const state = tempDir("workspace-state");
  made.push(state);
  const host = await startHost({
    checkout,
    ...(project === undefined ? {} : { project }),
    stateDir: state,
    serverCommand: fakeCommand,
    watch: false,
  });
  return { host, page: await FakePage.open(host.endpoint) };
}

describe("the folders of a workspace", () => {
  test("the workspace, the Git top folder and the paths between them", async () => {
    const { top, web, game } = await subfolderRepo();
    expect(findWorkspace(game, top)).toBe(web);
    expect(findWorkspace(join(game, "scenes"), top)).toBe(web);
    expect(findWorkspace(top, top)).toBe(top);
    // No package.json workspace up to the limit: the limit.
    expect(findWorkspace(join(top, "README.md"), top)).toBe(top);
    expect(gitTopOf(web, "web")).toBe(top);
    expect(gitTopOf(top, "")).toBe(top);
    expect(workspaceIn(top, "web")).toBe(web);
    expect(fromTop("web/game/a.ts", "web")).toBe("game/a.ts");
    expect(fromTop("README.md", "web")).toBe("../README.md");
    expect(fromTop("README.md", "frontend/web")).toBe("../../README.md");
    expect(fromTop("README.md", "")).toBe("README.md");
  });
});

describe("the host on a workspace in a sub-folder of a Git repository", () => {
  test("--project of the sub-folder: the checkout, a run, a scene save, the diff, the turns and the packet", async () => {
    const { top, web, game } = await subfolderRepo();
    const { host, page } = await start(game, game);
    try {
      const hello = (await page.call("host.hello")) as RequestResult<"host.hello">;
      expect(host.current()).toBe(web);
      expect(hello.checkout).toMatchObject({ path: web, branch: "main", open: true });
      expect(hello.project?.dir).toBe(game);
      expect(hello.git).toBe(true);
      // A run starts in the project folder.
      const run = host.runs.start(host.current(), "where", []);
      const result = await run.done;
      expect(result.code).toBe(0);
      expect(result.summary).toBe(realpathSync(game));

      // The save event names the file from the workspace. The Changes tab names it from the Git top folder.
      const read = (await page.call("scene.read", { path: SCENE })) as SceneFileText;
      const text = canonicalJson(scene(2));
      const saved = (await page.call("scene.save", { path: SCENE, text, baseHash: read.hash })) as SceneSaveResult;
      expect(saved).toMatchObject({ ok: true, changed: true });
      const event = await page.waitEvent((each) => each.type === "scene.saved");
      expect(event).toMatchObject({ path: `game/${SCENE}` });
      const status = (await page.call("git.status")) as RequestResult<"git.status">;
      expect(status.files).toEqual([{ status: " M", path: `web/game/${SCENE}` }]);
      const { patch } = (await page.call("git.diff", { paths: [`web/game/${SCENE}`] })) as { patch: string };
      expect(patch).toContain(`+++ b/web/game/${SCENE}`);
      expect(patch).toContain('+          "position": [2, 0, 0.5]');

      // The packet names the files from the workspace folder; a file outside it starts with `../`.
      writeFileSync(join(top, "README.md"), "changed\n");
      expect([...(await gitSummary(host.current())).changed].sort()).toEqual(["../README.md", `game/${SCENE}`]);
      // The files of a background run are paths from the workspace folder too.
      const dirty = new Set([`game/${SCENE}`]);
      expect(await changedFiles(host.current(), new Set(["game/new.ts"]), dirty, "web")).toEqual([
        "../README.md",
        "game/new.ts",
      ]);

      // A turn of Claude in the workspace keeps the paths of the Git top folder, and its undo works.
      const file = join(game, "scenes", "extra.scene.json");
      await host.turns.beginTurn(host.current(), "s1", { prompt: "add a scene" });
      writeFileSync(file, canonicalJson(scene(3)));
      await host.turns.recordEdits(host.current(), "s1", [file]);
      const turns = (await page.call("git.turns")) as RequestResult<"git.turns">;
      expect(turns.turns[0]?.files).toEqual(["web/game/scenes/extra.scene.json"]);
      const undo = await host.turns.undoTurn(host.current(), "s1", 1);
      expect(undo.deleted).toEqual(["web/game/scenes/extra.scene.json"]);
      expect(existsSync(file)).toBe(false);

      // A commit of the Changes tab takes the paths of the Git top folder.
      const commit = (await page.call("git.commit", {
        message: "Move the box",
        paths: [`web/game/${SCENE}`],
      })) as RequestResult<"git.commit">;
      expect(commit.commit).toMatch(/^[0-9a-f]{40}$/);
      const after = (await page.call("git.status")) as RequestResult<"git.status">;
      expect(after.files).toEqual([{ status: " M", path: "README.md" }]);
    } finally {
      page.close();
      await host.stop();
    }
  }, 30_000);

  test("--checkout of the sub-folder alone: the workspace is the checkout, with the built-in project", async () => {
    const { web } = await subfolderRepo();
    const { host, page } = await start(web);
    try {
      const hello = (await page.call("host.hello")) as RequestResult<"host.hello">;
      expect(hello.checkout).toMatchObject({ path: web, branch: "main", open: true });
      expect(hello.project).toMatchObject({ dir: web, manifest: null });
    } finally {
      page.close();
      await host.stop();
    }
  }, 30_000);

  test("--checkout and --project in the sub-folder: a new worktree gets the same sub-folder, its setup and its project", async () => {
    const { parent, top, web, game } = await subfolderRepo();
    const { host, page } = await start(web, game);
    try {
      expect(host.current()).toBe(web);
      expect(host.project().dir).toBe(game);
      const created = (await page.call("checkouts.create", { branch: "feature" })) as Checkout;
      const worktree = join(parent, "repo-feature");
      expect(created.path).toBe(join(worktree, "web"));
      expect(created.setup?.state).toBe("preparing");
      // The setup of the manifest runs in the workspace folder of the new worktree.
      await until(() => host.runs.info(created.setup?.run ?? "")?.status === "passed", 10_000, "the setup");
      expect(host.runs.info(created.setup?.run ?? "")?.summary).toBe(realpathSync(created.path));
      const list = (await page.call("checkouts.list")) as Checkout[];
      expect(list.map((item) => [item.path, item.branch])).toEqual([
        [web, "main"],
        [join(worktree, "web"), "feature"],
      ]);
      // The Git top folder of a worktree is not a checkout of this workspace.
      expect(await page.request("checkouts.open", { path: worktree })).toMatchObject({ ok: false });
      const opened = (await page.call("checkouts.open", { path: created.path })) as RequestResult<"checkouts.open">;
      expect(opened.checkout).toMatchObject({ path: created.path, branch: "feature", open: true });
      expect(host.current()).toBe(created.path);
      expect(host.project().dir).toBe(join(created.path, "game"));
      expect(readFileSync(join(worktree, "README.md"), "utf8")).toBe("test\n");
      // A branch with no workspace folder gives no checkout.
      await git(top, ["branch", "old", "HEAD~1"]);
      const old = await page.request("checkouts.create", { branch: "old" });
      expect(old.ok ? "" : old.error).toContain("has no folder web");
    } finally {
      page.close();
      await host.stop();
    }
  }, 30_000);
});
