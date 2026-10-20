// SPDX-License-Identifier: Apache-2.0
// The version control panel. The cases of the Changes tab of the workbench
// (`apps/workbench/tests/components/dock.vitest.ts`) pass in the studio panel: the files, a diff, the commit of the
// picked files, and the diff of a file after a save. The Git routes of the dev server run on a new repository in a
// temp folder.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parsePorcelain,
  parseWorktrees,
  vcsBranches,
  vcsCommit,
  vcsDiff,
  vcsStatus,
  vcsSwitch,
} from "../../scripts/vcsApi";
import VcsPanel from "../../src/scene/vcs/VcsPanel.vue";
import { editorI18n } from "../../src/texts";

const SCENE = "scenes/main.scene.json";
const before = JSON.stringify({
  format: "scenity.scene/1",
  entities: { box: { name: "Box", parent: null, index: 0, components: { transform: { position: [1.6, 0, -0.9] } } } },
});
const after = before.replace("[1.6, 0, -0.9]", "[1.9,0,-0.9]").replace("1.6,0,-0.9", "1.9,0,-0.9");

interface Call {
  readonly path: string;
  readonly body: unknown;
}

/** A fake dev server: the answer of each route, and the calls. */
function fakeServer(routes: Readonly<Record<string, (body: unknown) => unknown>>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (input: string, init?: RequestInit) => {
    const path = input.replace("/projects/p/", "");
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ path, body });
    const route = Object.keys(routes).find((key) => path.split("?")[0] === key);
    const value = route === undefined ? { reason: "no route" } : routes[route]?.(body);
    return Promise.resolve(new Response(JSON.stringify(value), { status: route === undefined ? 404 : 200 }));
  });
  return calls;
}

const status = (files: { path: string; status: string }[]) => ({ git: true, branch: "main", files });
const branches = {
  branches: [
    { name: "main", current: true, upstream: "origin/main", date: "" },
    { name: "agent/hat", current: false, upstream: null, date: "" },
  ],
  worktrees: [{ path: "/repo", branch: "main", head: "abc" }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("the version control panel", () => {
  it("lists the files, shows a diff, and commits the picked files", async () => {
    const calls = fakeServer({
      "vcs.status.json": () =>
        status([
          { path: "docs/notes.md", status: "M" },
          { path: SCENE, status: "M" },
        ]),
      "vcs.branches.json": () => branches,
      "vcs.diff.json": () => ({ patch: "@@ -1 +1 @@\n-old\n+new\n", before: "old\n", after: "new\n" }),
      "vcs.commit": () => ({ commit: "0123456789abcdef" }),
    });
    const tasks = () => Promise.resolve([{ id: "t1", name: "Lift the hat", branch: "agent/hat", state: "done" }]);
    const wrapper = mount(VcsPanel, {
      props: { base: "/projects/p/", tasks },
      global: { plugins: [editorI18n().plugin] },
    });
    await flushPromises();
    expect(wrapper.get("[data-testid=vcs-branch]").text()).toBe("main");
    expect(wrapper.findAll("[data-testid=vcs-files] li").map((item) => item.attributes("data-path"))).toEqual([
      "docs/notes.md",
      SCENE,
    ]);
    await wrapper.get("[data-testid='vcs-file-docs/notes.md']").trigger("click");
    await flushPromises();
    expect(calls.find((call) => call.path.startsWith("vcs.diff.json"))?.path).toBe(
      "vcs.diff.json?path=docs%2Fnotes.md",
    );
    expect(wrapper.find("[data-kind=add]").text()).toBe("+new");
    expect(wrapper.find("[data-kind=del]").text()).toBe("-old");
    // The tasks of the agents show under their branch.
    expect(wrapper.get("[data-branch='agent/hat'] [data-task=t1]").text()).toContain("Lift the hat");
    expect(wrapper.get("[data-testid=vcs-commit]").attributes("disabled")).toBeDefined();
    await wrapper.get("[data-testid='vcs-pick-docs/notes.md']").setValue(true);
    await wrapper.get("[data-testid=vcs-message]").setValue("Keep the hat on the head");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(calls.find((call) => call.path === "vcs.commit")?.body).toEqual({
      message: "Keep the hat on the head",
      paths: ["docs/notes.md"],
    });
    expect(wrapper.get("[data-testid=vcs-notice]").text()).toBe("Committed 0123456789.");
    wrapper.unmount();
  });

  it("a save of a scene file loads the panel again and shows the semantic diff of the file", async () => {
    const calls = fakeServer({
      "vcs.status.json": () => status([{ path: SCENE, status: "M" }]),
      "vcs.branches.json": () => branches,
      "vcs.diff.json": () => ({ patch: `@@ -1 +1 @@\n-${before}\n+${after}\n`, before, after }),
    });
    let listener: ((path: string) => void) | null = null;
    const onSaved = (next: (path: string) => void) => {
      listener = next;
      return () => undefined;
    };
    const wrapper = mount(VcsPanel, {
      props: { base: "/projects/p/", onSaved },
      global: { plugins: [editorI18n().plugin] },
    });
    await flushPromises();
    const loads = calls.filter((call) => call.path === "vcs.status.json").length;
    (listener as ((path: string) => void) | null)?.(SCENE);
    await flushPromises();
    expect(calls.filter((call) => call.path === "vcs.status.json").length).toBe(loads + 1);
    expect(wrapper.get("[data-entity=box] [data-field='transform.position']").text()).toContain("(1.9, 0, -0.9)");
    expect(wrapper.find("[data-testid=vcs-patch]").exists()).toBe(false);
    await wrapper.get("[data-testid=vcs-show-patch]").setValue(true);
    expect(wrapper.find("[data-testid=vcs-patch] [data-kind=add]").exists()).toBe(true);
    wrapper.unmount();
  });
});

describe("the Git routes of the dev server", () => {
  it("reads the porcelain status and the worktrees", () => {
    expect(parsePorcelain(" M p/a.json\0?? p/new.txt\0R  p/b.json\0p/old.json\0 M other/x\0", "p/")).toEqual([
      { path: "a.json", status: "M" },
      { path: "b.json", status: "R" },
      { path: "new.txt", status: "?" },
    ]);
    expect(
      parseWorktrees("worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /r2\nHEAD def\ndetached\n"),
    ).toEqual([
      { path: "/r", branch: "main", head: "abc" },
      { path: "/r2", branch: null, head: "def" },
    ]);
  });

  it("gives the status, the diff, a commit, the branches and a switch in a repository", async () => {
    const root = mkdtempSync(join(tmpdir(), "scenity-vcs-"));
    const dir = join(root, "project");
    const run = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
    try {
      mkdirSync(join(dir, "scenes"), { recursive: true });
      writeFileSync(join(dir, SCENE), before);
      writeFileSync(join(root, "outside.txt"), "x");
      run("init", "-q", "-b", "main");
      run("-c", "user.name=T", "-c", "user.email=t@example.com", "add", "-A");
      run("-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q", "-m", "first");
      run("branch", "agent/hat");
      writeFileSync(join(dir, SCENE), after);
      writeFileSync(join(dir, "notes.md"), "one\n");
      writeFileSync(join(root, "outside.txt"), "y");
      expect(await vcsStatus(dir)).toEqual({
        git: true,
        branch: "main",
        files: [
          { path: "notes.md", status: "?" },
          { path: SCENE, status: "M" },
        ],
      });
      const diff = await vcsDiff(dir, SCENE);
      expect(diff).toMatchObject({ before, after });
      expect(String(diff.patch)).toContain("+");
      expect((await vcsDiff(dir, "notes.md")).patch).toContain("+one");
      await expect(vcsCommit(dir, "two\nlines", [SCENE])).rejects.toThrow("one line");
      await expect(vcsCommit(dir, "x", ["../outside.txt"])).rejects.toThrow("files of the project");
      vi.stubEnv("GIT_AUTHOR_NAME", "T");
      vi.stubEnv("GIT_COMMITTER_NAME", "T");
      vi.stubEnv("GIT_AUTHOR_EMAIL", "t@example.com");
      vi.stubEnv("GIT_COMMITTER_EMAIL", "t@example.com");
      const commit = await vcsCommit(dir, "Move the box", [SCENE, "notes.md"]);
      expect(commit.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(run("log", "-1", "--format=%s")).toBe("Move the box\n");
      expect(((await vcsStatus(dir)).files as unknown[]).length).toBe(0);
      expect(readFileSync(join(root, "outside.txt"), "utf8")).toBe("y");
      const refs = await vcsBranches(dir);
      expect((refs.branches as { name: string; current: boolean }[]).map((item) => [item.name, item.current])).toEqual([
        ["agent/hat", false],
        ["main", true],
      ]);
      // The file outside the project folder has a change: the switch waits.
      await expect(vcsSwitch(dir, "agent/hat")).rejects.toThrow("commit them first");
      run("checkout", "--", "outside.txt");
      expect(await vcsSwitch(dir, "agent/hat")).toEqual({ branch: "agent/hat" });
      expect((await vcsStatus(dir)).branch).toBe("agent/hat");
      await expect(vcsSwitch(dir, "--force")).rejects.toThrow("no such branch");
    } finally {
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
