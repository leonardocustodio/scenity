// SPDX-License-Identifier: Apache-2.0
// The prop importer (blender/import_fbx_prop.py) reads the model of a promoted scratch prop: the `normalized.glb`
// that "Promote to the room" copies to the imports of the project, and an OBJ
// file. The fixtures come from code (tests/make_drop_fixtures.py). The test runs where Blender 5.2 is on this
// machine, as `py:test`.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blenderScript, hasLocalBlender, runBlender } from "../src/blender/run";

const folder = mkdtempSync(join(tmpdir(), "assets-import-prop-"));
afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

/** Make the master of a prop from a model file; returns the path of the master. */
function importProp(model: string, name: string): string {
  const out = join(folder, `${name}.blend`);
  const spec = JSON.stringify({ format: "fbx-prop", model });
  runBlender(
    ["--python", blenderScript("import_fbx_prop.py"), "--", "--asset", name, "--spec", spec, "--out", out],
    [folder],
  );
  return out;
}

describe.skipIf(!hasLocalBlender())("the prop importer and the model of a promoted prop", () => {
  const fixtures = join(folder, "fixtures");
  let made = false;
  function fixture(name: string): string {
    if (!made) {
      runBlender(["--python", blenderScript("tests/make_drop_fixtures.py"), "--", "--out", fixtures], [folder]);
      made = true;
    }
    return join(fixtures, name);
  }

  test("makes a master from a GLB file and from an OBJ file", () => {
    for (const [file, name] of [
      ["stool.glb", "prop_glb"],
      ["stool.obj", "prop_obj"],
    ] as const) {
      const master = importProp(fixture(file), name);
      expect(existsSync(master)).toBe(true);
      expect(statSync(master).size).toBeGreaterThan(0);
    }
  }, 120_000);

  test("refuses a model file of another format", () => {
    expect(() => importProp(fixture("stool_color.jpg"), "prop_jpg")).toThrow();
    expect(existsSync(join(folder, "prop_jpg.blend"))).toBe(false);
  }, 60_000);
});
