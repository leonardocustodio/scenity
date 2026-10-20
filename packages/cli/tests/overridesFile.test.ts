// SPDX-License-Identifier: Apache-2.0
/**
 * The override layer files of a project. The save of the scene files also writes a `*.overrides.json` file
 * (a variant of a scene). The writer reads it as an overrides document and writes the canonical form. It refuses a
 * document that does not read. An override layer has no rules.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveSceneFile, sceneFilePathProblem, savedFileKind } from "../src/sceneFile/files";

const temp = mkdtempSync(join(tmpdir(), "scenity-overrides-file-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const PATH = "scenes/room.evening.overrides.json";
const LAYER = {
  scene: "room",
  ops: [{ op: "set", path: "/entities/lamp/components/transform/position", value: [2, 0, 0] }],
  format: "scenity.overrides/1",
};

describe("the override layer files of a project", () => {
  test("the contract knows the override layer files", () => {
    expect(savedFileKind(PATH)).toBe("overrides");
    expect(sceneFilePathProblem(PATH)).toBeNull();
    expect(sceneFilePathProblem("scenes/.overrides.json")).toContain(".overrides.json");
  });

  test("a save writes a new layer in the canonical form and refuses a layer that does not read", () => {
    const dir = join(temp, "p1");
    mkdirSync(join(dir, "scenes"), { recursive: true });
    const result = saveSceneFile(dir, { path: PATH, text: JSON.stringify(LAYER), baseHash: null });
    expect(result).toMatchObject({ ok: true, changed: true });
    const disk = readFileSync(join(dir, PATH), "utf8");
    expect(disk.indexOf('"format"')).toBeLessThan(disk.indexOf('"scene"'));
    expect(JSON.parse(disk)).toEqual(LAYER);
    const refused = saveSceneFile(dir, {
      path: "scenes/room.bad.overrides.json",
      text: JSON.stringify({ ...LAYER, ops: "none" }),
      baseHash: null,
    });
    expect(refused.ok || refused.conflict ? null : refused.reason).toContain("The override layer does not read");
  });
});
