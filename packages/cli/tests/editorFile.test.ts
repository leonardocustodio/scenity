// SPDX-License-Identifier: Apache-2.0
/**
 * The editor settings file of a project: the save of the scene files also writes `scenity.editor.json` at
 * the root of the project folder. The writer reads it as an editor settings document and writes the canonical form.
 * It refuses a document that does not read, a file that changed on the disk, and the same name in a subfolder. The
 * settings have no rules, so a save with no rule results goes through the gate that measures by itself.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveMeasured } from "../src/check/save";
import { saveSceneFile, sceneFilePathProblem, savedFileKind } from "../src/sceneFile/files";

const temp = mkdtempSync(join(tmpdir(), "scenity-editor-file-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const PATH = "scenity.editor.json";
let count = 0;

function project(): string {
  count += 1;
  const dir = join(temp, `p${String(count)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("the editor settings file of a project", () => {
  test("the contract knows the file at the project root only", () => {
    expect(savedFileKind(PATH)).toBe("editor");
    expect(sceneFilePathProblem(PATH)).toBeNull();
    expect(savedFileKind(`scenes/${PATH}`)).toBeNull();
    expect(sceneFilePathProblem(`scenes/${PATH}`)).toContain(PATH);
  });

  test("a save creates the file in the canonical form and refuses a stale base", () => {
    const dir = project();
    const text = JSON.stringify({ snaps: { grid: 0.05 }, format: "scenity.editor/1" });
    const result = saveSceneFile(dir, { path: PATH, text, baseHash: null });
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(readFileSync(join(dir, PATH), "utf8")).toBe(
      '{\n  "format": "scenity.editor/1",\n  "snaps": {\n    "grid": 0.05\n  }\n}\n',
    );
    expect(saveSceneFile(dir, { path: PATH, text, baseHash: null })).toMatchObject({ ok: false, conflict: true });
  });

  test("a save refuses settings that do not read, and the measured save writes the settings", async () => {
    const dir = project();
    const bad = saveSceneFile(dir, {
      path: PATH,
      text: '{"format":"scenity.editor/1","snaps":{"grid":-1}}',
      baseHash: null,
    });
    expect(bad).toMatchObject({ ok: false, conflict: false });
    expect(bad.ok || bad.conflict ? "" : bad.reason).toContain("The editor settings do not read");
    const text = JSON.stringify({ format: "scenity.editor/1", view: { mode: "unlit" } });
    expect(await saveMeasured(dir, { path: PATH, text, baseHash: null })).toMatchObject({ ok: true });
  });
});
