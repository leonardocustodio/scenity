// SPDX-License-Identifier: Apache-2.0
/**
 * The scene file requests through a host. An editor page reads a scene file of the project and saves it. The host
 * writes the canonical form and refuses a save over a file that changed on the disk. It refuses a viewer page and a
 * file of the denylist. It sends `scene.saved`, and then `git.diff` (the Changes tab) shows the JSON diff.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "@scenity/scene";
import { sceneTextHash } from "@scenity/cli/sceneFile";
import { parseRoleTokens } from "../src/authProvider";
import { git } from "../src/exec";
import { startHost, type Host } from "../src/host";
import type { SceneFileText, SceneSaveResult } from "../src/protocol";
import { scaleTestTimeouts } from "./ciTiming";
import { cleanup, fakeCommand, FakePage, makeRepo, rejectsWith, tempDir } from "./helpers";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const VIEWER = "3c".repeat(32);
const EDITOR = "4d".repeat(32);
const PATH = "scenes/main.scene.json";
const made: string[] = [];
afterAll(() => cleanup(...made));

/** A block rule of the scene: the box stays within 2 m of the origin. */
const NEAR_RULE = {
  id: "box.near",
  metric: "distance",
  args: { from: "entity:box", to: [0, 0, 0] },
  max: 2,
  level: "block",
};

/** A scene with the box at x, and its rules. */
function scene(x: number, rules?: unknown[]): unknown {
  const transform = { position: [x, 0, 0.5] };
  return {
    format: "scenity.scene/1",
    id: "main",
    entities: { box: { parent: null, index: 0, components: { transform } } },
    ...(rules === undefined ? {} : { rules }),
  };
}

/** A project folder in a Git repository with a committed scene, and a host on it with role tokens. */
async function projectHost(rules?: unknown[]): Promise<{ host: Host; project: string; repo: string }> {
  const { parent, repo } = await makeRepo();
  const state = tempDir("scene-files-state");
  made.push(parent, state);
  const project = join(repo, "game");
  mkdirSync(join(project, "scenes"), { recursive: true });
  const manifest = { format: "scenity.project/1", id: "game", name: "Game", scenes: [PATH] };
  writeFileSync(join(project, "scenity.project.json"), canonicalJson(manifest));
  writeFileSync(join(project, PATH), canonicalJson(scene(1, rules)));
  writeFileSync(join(project, "scenes/.env.scene.json"), canonicalJson(scene(9)));
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "--quiet", "-m", "project"]);
  const host = await startHost({
    checkout: repo,
    project,
    stateDir: state,
    serverCommand: fakeCommand,
    watch: false,
    auth: { kind: "token", tokens: parseRoleTokens(`viewer:${VIEWER},editor:${EDITOR}`) },
  });
  return { host, project, repo };
}

describe("the scene files through a host", () => {
  test("read, save, the JSON diff of the Changes tab, a conflict, a viewer and the denylist", async () => {
    const { host, project } = await projectHost();
    const editor = await FakePage.open({ origin: host.endpoint.origin, token: EDITOR });
    const viewer = await FakePage.open({ origin: host.endpoint.origin, token: VIEWER });
    try {
      const read = (await editor.call("scene.read", { path: PATH })) as SceneFileText;
      expect(read.text).toBe(canonicalJson(scene(1)));
      // A loose text: the host writes the canonical form.
      const text = JSON.stringify(scene(1.5));
      const saved = (await editor.call("scene.save", { path: PATH, text, baseHash: read.hash })) as SceneSaveResult;
      expect(saved).toMatchObject({ ok: true, changed: true, text: canonicalJson(scene(1.5)) });
      expect(readFileSync(join(project, PATH), "utf8")).toBe(canonicalJson(scene(1.5)));
      const event = await editor.waitEvent((each) => each.type === "scene.saved");
      expect(event).toMatchObject({ path: `game/${PATH}` });
      const { patch } = (await editor.call("git.diff", { paths: [`game/${PATH}`] })) as { patch: string };
      expect(patch).toContain('-          "position": [1, 0, 0.5]');
      expect(patch).toContain('+          "position": [1.5, 0, 0.5]');
      // The base of the first read is old: a conflict, and the file stays.
      const again = (await editor.call("scene.save", { path: PATH, text, baseHash: read.hash })) as SceneSaveResult;
      expect(again).toMatchObject({ ok: false, conflict: true });
      expect(
        (await editor.call("scene.save", { path: PATH, text, baseHash: read.hash, force: true })) as object,
      ).toMatchObject({
        ok: true,
        changed: false,
      });
      // A viewer can read and cannot save.
      expect(((await viewer.call("scene.read", { path: PATH })) as SceneFileText).hash).toBeString();
      const refused = await viewer.request("scene.save", { path: PATH, text, baseHash: null });
      expect(refused.ok ? "" : refused.error).toContain("The role viewer cannot");
      // The denylist and a path out of the project.
      const denied = (await editor.call("scene.save", {
        path: "scenes/.env.scene.json",
        text,
        baseHash: null,
        force: true,
      })) as SceneSaveResult;
      expect(denied).toMatchObject({ ok: false, conflict: false });
      expect(denied.ok || denied.conflict ? "" : denied.reason).toContain("does not let");
      const out = await editor.request("scene.read", { path: "../README.scene.json" });
      expect(out.ok).toBe(false);
      await rejectsWith(editor.call("scene.save", { path: PATH, text }), "baseHash");
    } finally {
      editor.close();
      viewer.close();
      await host.stop();
    }
  });
});

describe("the rule gate of a scene save through a host", () => {
  test("a failed block rule refuses scene.save without a reason and accepts it with one", async () => {
    const { host, project } = await projectHost([NEAR_RULE]);
    const editor = await FakePage.open({ origin: host.endpoint.origin, token: EDITOR });
    try {
      const read = (await editor.call("scene.read", { path: PATH })) as SceneFileText;
      const text = JSON.stringify(scene(3, [NEAR_RULE]));
      // The results of the page for this text: the box is 3 m away.
      const verdict = { id: "box.near", level: "block", status: "fail", detail: "3.04 m, max 2 m" };
      const checks = { hash: sceneTextHash(text), verdicts: [verdict] };
      const params = { path: PATH, text, baseHash: read.hash, checks };
      const refused = (await editor.call("scene.save", params)) as SceneSaveResult;
      expect(refused).toMatchObject({ ok: false, conflict: false, blocked: [{ id: "box.near", status: "fail" }] });
      expect(refused.ok || refused.conflict ? "" : refused.reason).toContain("Give a reason to save anyway.");
      expect(readFileSync(join(project, PATH), "utf8")).toBe(canonicalJson(scene(1, [NEAR_RULE])));
      // A save with no results (Claude, a tool): the writer measures the rules and refuses it too.
      const bare = (await editor.call("scene.save", { path: PATH, text, baseHash: read.hash })) as SceneSaveResult;
      expect(bare).toMatchObject({ ok: false, conflict: false, blocked: [{ id: "box.near", status: "fail" }] });
      expect(bare.ok || bare.conflict ? "" : bare.blocked?.[0]?.detail).toContain("max 2 m");
      const reason = "the box goes out for the demo";
      const saved = (await editor.call("scene.save", { ...params, reason })) as SceneSaveResult;
      expect(saved).toMatchObject({ ok: true, changed: true, override: reason });
      expect(readFileSync(join(project, PATH), "utf8")).toBe(canonicalJson(scene(3, [NEAR_RULE])));
      // The reason is in the log next to the scene and in the commit message proposal of the Changes tab.
      const log = readFileSync(join(project, "scenes/main.rules-log.jsonl"), "utf8");
      expect(JSON.parse(log)).toMatchObject({ scene: PATH, reason, rules: [{ id: "box.near" }] });
      const turns = (await editor.call("git.turns", {})) as { proposal: string };
      expect(turns.proposal).toContain(`${PATH}: ${reason}`);
    } finally {
      editor.close();
      await host.stop();
    }
  });
});

describe("the writer gate measures by itself", () => {
  test("a save with no results passes when the measured rules pass", async () => {
    const { host, project } = await projectHost([NEAR_RULE]);
    const editor = await FakePage.open({ origin: host.endpoint.origin, token: EDITOR });
    try {
      const read = (await editor.call("scene.read", { path: PATH })) as SceneFileText;
      const text = JSON.stringify(scene(1.5, [NEAR_RULE]));
      const saved = (await editor.call("scene.save", { path: PATH, text, baseHash: read.hash })) as SceneSaveResult;
      expect(saved).toMatchObject({ ok: true, changed: true });
      expect(readFileSync(join(project, PATH), "utf8")).toBe(canonicalJson(scene(1.5, [NEAR_RULE])));
    } finally {
      editor.close();
      await host.stop();
    }
  });
});
