// SPDX-License-Identifier: Apache-2.0
/**
 * The create of a new scene file. The writer makes the empty scene document in its canonical form, lists the
 * path in a project file that lists its scenes, never replaces a file, and refuses a bad path, a path of the denylist
 * and a link out of the project. A save as is a save to a new path with no base hash: it runs the rule gate.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "@scenity/scene";
import { createSceneFile, saveSceneFile, sceneTextHash } from "../src/sceneFile/files";

const temp = mkdtempSync(join(tmpdir(), "scenity-scene-create-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const MAIN = "scenes/main.scene.json";
let count = 0;

/** A temp project with one scene; `scenes` is the list of the project file. */
function project(scenes: readonly string[] = [MAIN]): string {
  count += 1;
  const dir = join(temp, `p${String(count)}`);
  mkdirSync(join(dir, "scenes"), { recursive: true });
  const manifest = { format: "scenity.project/1", id: "game", name: "Game", scenes };
  writeFileSync(join(dir, "scenity.project.json"), canonicalJson(manifest));
  writeFileSync(join(dir, MAIN), canonicalJson({ format: "scenity.scene/1", id: "main", entities: {} }));
  return dir;
}

function scenesOf(dir: string): unknown {
  return (JSON.parse(readFileSync(join(dir, "scenity.project.json"), "utf8")) as { scenes: unknown }).scenes;
}

describe("create a scene file", () => {
  test("writes the empty scene in its canonical form and lists it in the project file", () => {
    const dir = project();
    const path = "scenes/night.scene.json";
    const result = createSceneFile(dir, { path, sceneId: "night", name: " Night " });
    const text = canonicalJson({ format: "scenity.scene/1", id: "night", name: "Night", entities: {} });
    expect(result).toEqual({ ok: true, path, hash: sceneTextHash(text), text, listed: true });
    expect(readFileSync(join(dir, path), "utf8")).toBe(text);
    expect(scenesOf(dir)).toEqual([MAIN, path]);
    // A second create of the path refuses and changes nothing.
    const again = createSceneFile(dir, { path, sceneId: "other", name: "Other" });
    expect(again).toMatchObject({ ok: false, path });
    expect(again.ok ? "" : again.reason).toContain("already");
    expect(readFileSync(join(dir, path), "utf8")).toBe(text);
  });

  test("makes a new folder, and leaves a project file with no scene list as it is", () => {
    const dir = project([]);
    const before = readFileSync(join(dir, "scenity.project.json"), "utf8");
    const result = createSceneFile(dir, { path: "levels/one/a.scene.json", sceneId: "a", name: "A" });
    expect(result).toMatchObject({ ok: true, listed: false });
    expect(readFileSync(join(dir, "scenity.project.json"), "utf8")).toBe(before);
  });

  test("refuses a bad path, a path of the denylist and a link out of the project", () => {
    const dir = project();
    const outside = join(temp, `outside-${String(count)}`);
    mkdirSync(outside);
    symlinkSync(outside, join(dir, "out"));
    const denied = (path: string): boolean => path.split("/").some((part) => part.startsWith("."));
    const refused = [
      createSceneFile(dir, { path: "../x.scene.json", sceneId: "x", name: "X" }),
      createSceneFile(dir, { path: "scenes/x.sequence.json", sceneId: "x", name: "X" }),
      createSceneFile(dir, { path: "scenes/x.scene.json", sceneId: "bad id", name: "X" }),
      createSceneFile(dir, { path: "scenes/x.scene.json", sceneId: "x", name: "" }),
      createSceneFile(dir, { path: "scenes/.hidden.scene.json", sceneId: "x", name: "X" }, { denied }),
      createSceneFile(dir, { path: "out/x.scene.json", sceneId: "x", name: "X" }),
    ];
    for (const result of refused) expect(result.ok).toBe(false);
    expect(refused[4]?.ok === false && refused[4].reason).toContain("does not let");
    expect(refused[5]?.ok === false && refused[5].reason).toContain("not in the project folder");
    expect(scenesOf(dir)).toEqual([MAIN]);
  });

  test("a save as writes a new path with no base hash, and refuses a path that is there already", () => {
    const dir = project();
    const text = canonicalJson({ format: "scenity.scene/1", id: "main", name: "Copy", entities: {} });
    const copy = saveSceneFile(dir, { path: "scenes/copy.scene.json", text, baseHash: null, force: false });
    expect(copy).toMatchObject({ ok: true, changed: true });
    expect(readFileSync(join(dir, "scenes/copy.scene.json"), "utf8")).toBe(text);
    const over = saveSceneFile(dir, { path: MAIN, text, baseHash: null });
    expect(over).toMatchObject({ ok: false, conflict: true });
  });
});
