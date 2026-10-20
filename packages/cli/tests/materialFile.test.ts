// SPDX-License-Identifier: Apache-2.0
/**
 * The material files of a project: the save of the scene files also writes a `*.material.json` file. The
 * writer reads it as a material document and writes the canonical form. It refuses a document that does not read (a
 * value that the type does not take), a file that changed on the disk, a path of the denylist and an asset record. A
 * material has no rules, so a save with no rule results goes through the gate that measures by itself.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveMeasured } from "../src/check/save";
import { readSceneFile, saveSceneFile, sceneFilePathProblem, savedFileKind } from "../src/sceneFile/files";

const temp = mkdtempSync(join(tmpdir(), "scenity-material-file-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const PATH = "assets/materials/red.material.json";
const MATERIAL = { type: "standard", format: "scenity.material/1", colour: "#ff0000", roughness: 0.5 };

let count = 0;

/** A temp project with one material file in a loose (not canonical) form. */
function project(): string {
  count += 1;
  const dir = join(temp, `p${String(count)}`);
  mkdirSync(join(dir, "assets/materials"), { recursive: true });
  writeFileSync(join(dir, PATH), JSON.stringify(MATERIAL));
  writeFileSync(join(dir, `${PATH}.meta.json`), "{}");
  return dir;
}

describe("the material files of a project", () => {
  test("the contract knows the material files", () => {
    expect(savedFileKind(PATH)).toBe("material");
    expect(sceneFilePathProblem(PATH)).toBeNull();
    expect(sceneFilePathProblem("assets/.material.json")).not.toBeNull();
    expect(sceneFilePathProblem(`${PATH}.meta.json`)).toContain(".material.json");
  });

  test("a save writes the canonical form and refuses a stale base", () => {
    const dir = project();
    const base = readSceneFile(dir, PATH);
    const text = JSON.stringify({ ...MATERIAL, roughness: 0.25, colour: "#00ff00" });
    const result = saveSceneFile(dir, { path: PATH, text, baseHash: base.hash });
    expect(result).toMatchObject({ ok: true, changed: true });
    const disk = readFileSync(join(dir, PATH), "utf8");
    expect(disk).toBe(
      '{\n  "colour": "#00ff00",\n  "format": "scenity.material/1",\n  "roughness": 0.25,\n  "type": "standard"\n}\n',
    );
    expect(saveSceneFile(dir, { path: PATH, text, baseHash: base.hash })).toMatchObject({ ok: false, conflict: true });
  });

  test("a save refuses a material that does not read and a path of the denylist", () => {
    const dir = project();
    const base = readSceneFile(dir, PATH).hash;
    const refused = (text: string, denied?: (path: string) => boolean) => {
      const result = saveSceneFile(dir, { path: PATH, text, baseHash: base }, denied === undefined ? {} : { denied });
      return result.ok || result.conflict ? null : result.reason;
    };
    // A phong value on a standard material: the type does not take it.
    expect(refused(JSON.stringify({ ...MATERIAL, shininess: 30 }))).toContain("The material does not read");
    expect(refused(JSON.stringify({ ...MATERIAL, roughness: 2 }))).toContain("does not read");
    expect(refused(JSON.stringify(MATERIAL), (path) => path.startsWith("assets/"))).toContain("does not let");
  });

  test("a save with no rule results measures no rules for a material", async () => {
    const dir = project();
    writeFileSync(
      join(dir, "scenity.project.json"),
      JSON.stringify({ format: "scenity.project/1", id: "p", name: "P", scenes: [], assets: ["assets"] }),
    );
    const base = readSceneFile(dir, PATH).hash;
    const text = JSON.stringify({ ...MATERIAL, metalness: 1 });
    const result = await saveMeasured(dir, { path: PATH, text, baseHash: base });
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(JSON.parse(readFileSync(join(dir, PATH), "utf8"))).toMatchObject({ metalness: 1 });
  });
});
