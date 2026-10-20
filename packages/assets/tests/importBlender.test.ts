// SPDX-License-Identifier: Apache-2.0
// The Blender importers: FBX, OBJ and .blend through the pinned Blender with the default settings, the recipe
// path of the settings, and a settings change that imports again. The tests run where Blender 5.2 is on this machine
// (BLENDER, or the Blender app of macOS), as `py:test`.
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blenderScript, hasLocalBlender, runBlender } from "../src/blender/run";
import { importAsset } from "../src/import/run";
import { writeAssetRecord } from "../src/record";
import { put, record, removeTemps } from "./helpers";
import { boundsOf, importProject, readModel, writeRecord } from "./importHelpers";

const BLENDER = hasLocalBlender();
if (!BLENDER) {
  console.warn(
    "skip: the Blender importer tests need Blender 5.2 on this machine: set BLENDER to its path, or install " +
      "/Applications/Blender.app on macOS",
  );
}

const BLEND_ID = "01J9Z6Q3R9BLEND000000000AA";
const fixtures = mkdtempSync(join(tmpdir(), "assets-import-blend-"));
afterAll(() => {
  removeTemps();
  rmSync(fixtures, { recursive: true, force: true });
});

describe.skipIf(!BLENDER)("the Blender importers with the default settings", () => {
  test("an FBX file keeps its size and its source origin, with a PNG texture", async () => {
    const dir = importProject();
    const outcome = await importAsset(dir, "assets/box.fbx.meta.json");
    expect(outcome.stamp.report).toMatchObject({ path: "normalize", meshes: 2, textures: ["image/png"] });
    expect(outcome.stamp.report.extent).toEqual([0.5, 0.6, 0.5]);
    const { min } = boundsOf(await readModel(outcome.outDir));
    expect(min[1]).toBeCloseTo(1, 3);
  }, 60_000);

  test("an OBJ file in centimetres becomes metres", async () => {
    const dir = importProject();
    const outcome = await importAsset(dir, "assets/box.obj.meta.json");
    expect(outcome.stamp.report.extent).toEqual([0.5, 0.6, 0.5]);
    expect(outcome.stamp.warnings.some((line) => line.includes("centimetres"))).toBe(true);
  }, 60_000);

  test("a .blend file applies the parent transform and the modifier", async () => {
    runBlender(["--python", blenderScript("tests/make_drop_fixtures.py"), "--", "--out", fixtures], [fixtures]);
    const dir = importProject();
    cpSync(join(fixtures, "stool.blend"), join(dir, "assets/stool.blend"));
    const value = record(BLEND_ID, "stool.blend", { importer: "blend", rights: "../rights.yaml" });
    put(dir, "assets/stool.blend.meta.json", writeAssetRecord(value));
    const outcome = await importAsset(dir, "assets/stool.blend.meta.json");
    // The parent scales the stool of 0.47 m by 0.5.
    expect((outcome.stamp.report.extent as number[])[1]).toBeCloseTo(0.235, 3);
  }, 60_000);
});

describe.skipIf(!BLENDER)("the Blender importers with settings", () => {
  test("a settings change imports the FBX file again; the recipe gives a socket and a point origin", async () => {
    const dir = importProject();
    const first = await importAsset(dir, "assets/box.fbx.meta.json");
    expect((await importAsset(dir, "assets/box.fbx.meta.json")).status).toBe("current");
    writeRecord(dir, "box.fbx", { settings: { scale: 2, origin: "base-centre" } });
    const scaled = await importAsset(dir, "assets/box.fbx.meta.json");
    expect(scaled.status).toBe("imported");
    expect(scaled.stamp.key).not.toBe(first.stamp.key);
    expect(scaled.stamp.report.extent).toEqual([1, 1.2, 1]);
    expect(boundsOf(await readModel(scaled.outDir)).min[1]).toBeCloseTo(0, 3);
    // The recipe: the base centre of the box (Blender frame, Z up) becomes the origin, and a socket marks the top.
    const settings = { origin: [2, 0, 1], sockets: { top: { at: [0, 0, 0.6] } } };
    writeRecord(dir, "box.fbx", { settings });
    const recipe = await importAsset(dir, "assets/box.fbx.meta.json");
    expect(recipe.stamp.report.path).toBe("recipe");
    const model = await readModel(recipe.outDir);
    const top = model
      .getRoot()
      .listNodes()
      .find((node) => node.getName() === "top");
    expect(top?.getTranslation()[1]).toBeCloseTo(0.6, 3);
    expect(boundsOf(model).min[1]).toBeCloseTo(0, 3);
  }, 120_000);
});
