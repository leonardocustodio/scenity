// SPDX-License-Identifier: Apache-2.0
/**
 * A new scene and a save as through a host. An editor page creates a scene file: the host writes the empty scene,
 * lists it in the project file and sends `scene.saved`. The host refuses a second create of the path, a viewer page,
 * a path of the denylist and a path out of the project. A save as is a `scene.save` to a new path with no base hash.
 * The rule gate applies, and a save as over a file that is there gives a conflict.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "@scenity/scene";
import { sceneTextHash } from "@scenity/cli/sceneFile";
import { parseRoleTokens } from "../src/authProvider";
import { git } from "../src/exec";
import { startHost, type Host } from "../src/host";
import type { SceneCreateResult, SceneSaveResult } from "../src/protocol";
import { scaleTestTimeouts } from "./ciTiming";
import { cleanup, fakeCommand, FakePage, makeRepo, tempDir } from "./helpers";

scaleTestTimeouts();

const VIEWER = "5e".repeat(32);
const EDITOR = "6f".repeat(32);
const MAIN = "scenes/main.scene.json";
const NIGHT = "scenes/night.scene.json";
const made: string[] = [];
afterAll(() => cleanup(...made));

/** A block rule of the project: the box stays within 2 m of the origin. */
const NEAR_RULE = {
  id: "box.near",
  metric: "distance",
  args: { from: "entity:box", to: [0, 0, 0] },
  max: 2,
  level: "block",
};

function scene(x: number): unknown {
  const transform = { position: [x, 0, 0.5] };
  return {
    format: "scenity.scene/1",
    id: "main",
    entities: { box: { parent: null, index: 0, components: { transform } } },
  };
}

/** A project in a Git repository with one scene and a block rule, and a host on it with role tokens. */
async function projectHost(): Promise<{ host: Host; project: string }> {
  const { parent, repo } = await makeRepo();
  const state = tempDir("scene-create-state");
  made.push(parent, state);
  const project = join(repo, "game");
  mkdirSync(join(project, "scenes"), { recursive: true });
  const manifest = { format: "scenity.project/1", id: "game", name: "Game", scenes: [MAIN], rules: [NEAR_RULE] };
  writeFileSync(join(project, "scenity.project.json"), canonicalJson(manifest));
  writeFileSync(join(project, MAIN), canonicalJson(scene(1)));
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
  return { host, project };
}

function scenesOf(project: string): unknown {
  return (JSON.parse(readFileSync(join(project, "scenity.project.json"), "utf8")) as { scenes: unknown }).scenes;
}

describe("a new scene and a save as through a host", () => {
  test("create: the empty scene, the project list, the event, and the refusals", async () => {
    const { host, project } = await projectHost();
    const editor = await FakePage.open({ origin: host.endpoint.origin, token: EDITOR });
    const viewer = await FakePage.open({ origin: host.endpoint.origin, token: VIEWER });
    try {
      const created = (await editor.call("scene.create", {
        path: NIGHT,
        sceneId: "night",
        name: "Night",
      })) as SceneCreateResult;
      const text = canonicalJson({ format: "scenity.scene/1", id: "night", name: "Night", entities: {} });
      expect(created).toEqual({ ok: true, path: NIGHT, hash: sceneTextHash(text), text, listed: true });
      expect(readFileSync(join(project, NIGHT), "utf8")).toBe(text);
      expect(scenesOf(project)).toEqual([MAIN, NIGHT]);
      const event = await editor.waitEvent((each) => each.type === "scene.saved");
      expect(event).toMatchObject({ path: `game/${NIGHT}` });
      // A create never replaces a file.
      const again = (await editor.call("scene.create", { path: NIGHT, sceneId: "x", name: "X" })) as SceneCreateResult;
      expect(again).toMatchObject({ ok: false, path: NIGHT });
      // A viewer cannot create; the denylist and a path out of the project are refused.
      const refused = await viewer.request("scene.create", { path: "scenes/v.scene.json", sceneId: "v", name: "V" });
      expect(refused.ok ? "" : refused.error).toContain("The role viewer cannot");
      const denied = (await editor.call("scene.create", {
        path: "scenes/.env.scene.json",
        sceneId: "e",
        name: "E",
      })) as SceneCreateResult;
      expect(denied.ok ? "" : denied.reason).toContain("does not let");
      const out = (await editor.call("scene.create", {
        path: "../x.scene.json",
        sceneId: "x",
        name: "X",
      })) as SceneCreateResult;
      expect(out.ok).toBe(false);
      expect(scenesOf(project)).toEqual([MAIN, NIGHT]);
    } finally {
      editor.close();
      viewer.close();
      await host.stop();
    }
  });

  test("save as: a new path with no base hash, the rule gate, and a conflict over a file that is there", async () => {
    const { host, project } = await projectHost();
    const editor = await FakePage.open({ origin: host.endpoint.origin, token: EDITOR });
    try {
      const copy = "scenes/copy.scene.json";
      // The box is 3 m away: the writer measures the block rule and refuses the save as with no reason.
      const far = JSON.stringify(scene(3));
      const blocked = (await editor.call("scene.save", { path: copy, text: far, baseHash: null })) as SceneSaveResult;
      expect(blocked).toMatchObject({ ok: false, conflict: false, blocked: [{ id: "box.near" }] });
      const near = JSON.stringify(scene(1.5));
      const saved = (await editor.call("scene.save", { path: copy, text: near, baseHash: null })) as SceneSaveResult;
      expect(saved).toMatchObject({ ok: true, changed: true, path: copy });
      expect(readFileSync(join(project, copy), "utf8")).toBe(canonicalJson(scene(1.5)));
      expect(readFileSync(join(project, MAIN), "utf8")).toBe(canonicalJson(scene(1)));
      const over = (await editor.call("scene.save", { path: MAIN, text: near, baseHash: null })) as SceneSaveResult;
      expect(over).toMatchObject({ ok: false, conflict: true });
    } finally {
      editor.close();
      await host.stop();
    }
  });
});
