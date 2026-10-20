// SPDX-License-Identifier: Apache-2.0
/**
 * The prefab files of a project. The save of the scene files also writes a `*.prefab.json` file. The writer reads it
 * as a prefab document and writes the canonical form. It refuses a document that does not read (a second root) and a
 * file that changed on the disk. A prefab has no rules. Thus a save with no rule results goes through the gate that
 * measures by itself, also when the project has a block rule.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveMeasured } from "../src/check/save";
import { readSceneFile, saveSceneFile, sceneFilePathProblem, savedFileKind } from "../src/sceneFile/files";

const temp = mkdtempSync(join(tmpdir(), "scenity-prefab-file-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const PATH = "scenes/stool.prefab.json";
const PREFAB = {
  root: "base",
  format: "scenity.prefab/1",
  id: "stool",
  entities: {
    base: { parent: null, index: 0, components: { transform: { position: [0, 0, 0] } } },
    seat: { parent: "base", index: 0, components: { transform: { position: [0, 0.45, 0] } } },
  },
};

let count = 0;

/** A temp project with one prefab file in a loose (not canonical) form. */
function project(): string {
  count += 1;
  const dir = join(temp, `p${String(count)}`);
  mkdirSync(join(dir, "scenes"), { recursive: true });
  writeFileSync(join(dir, PATH), JSON.stringify(PREFAB));
  return dir;
}

describe("the prefab files of a project", () => {
  test("the contract knows the prefab files", () => {
    expect(savedFileKind(PATH)).toBe("prefab");
    expect(sceneFilePathProblem(PATH)).toBeNull();
    expect(sceneFilePathProblem("scenes/.prefab.json")).not.toBeNull();
  });

  test("a save writes the canonical form and refuses a stale base", () => {
    const dir = project();
    const base = readSceneFile(dir, PATH);
    const seat = { parent: "base", index: 0, components: { transform: { position: [0, 0.5, 0] } } };
    const text = JSON.stringify({ ...PREFAB, entities: { ...PREFAB.entities, seat } });
    const result = saveSceneFile(dir, { path: PATH, text, baseHash: base.hash });
    expect(result).toMatchObject({ ok: true, changed: true });
    const disk = readFileSync(join(dir, PATH), "utf8");
    expect(disk.startsWith('{\n  "entities": {\n    "base": {')).toBe(true);
    expect(JSON.parse(disk)).toMatchObject({
      entities: { seat: { components: { transform: { position: [0, 0.5, 0] } } } },
    });
    expect(saveSceneFile(dir, { path: PATH, text, baseHash: base.hash })).toMatchObject({ ok: false, conflict: true });
  });

  test("a save refuses a prefab that does not read", () => {
    const dir = project();
    const base = readSceneFile(dir, PATH).hash;
    const second = { parent: null, index: 1, components: {} };
    const text = JSON.stringify({ ...PREFAB, entities: { ...PREFAB.entities, second } });
    const result = saveSceneFile(dir, { path: PATH, text, baseHash: base });
    expect(result.ok || result.conflict ? null : result.reason).toContain("The prefab does not read");
  });

  test("a save with no rule results measures no rules for a prefab", async () => {
    const dir = project();
    const rule = { id: "p.floor", metric: "belowFloor", args: { floor: "floor" }, max: 0, level: "block" };
    writeFileSync(
      join(dir, "scenity.project.json"),
      JSON.stringify({ format: "scenity.project/1", id: "p", name: "P", scenes: [], rules: [rule] }),
    );
    const base = readSceneFile(dir, PATH).hash;
    const text = JSON.stringify({ ...PREFAB, name: "Stool" });
    const result = await saveMeasured(dir, { path: PATH, text, baseHash: base });
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(JSON.parse(readFileSync(join(dir, PATH), "utf8"))).toMatchObject({ name: "Stool" });
  });
});
