// SPDX-License-Identifier: Apache-2.0
/**
 * The scene files of a project. A save writes the canonical form through a temp file and a rename. It refuses a file
 * that changed on the disk after the load, unless `force` is true. It also refuses a path out of the project, a link
 * out of the project, a file of the denylist and a document that does not read. A read gives the hash of the bytes.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDocument, writeDocument } from "@scenity/scene";
import {
  canonicalSceneText,
  isSceneSaveParams,
  readSceneFile,
  saveSceneFile,
  sceneFilePathProblem,
  sceneTextHash,
} from "../src/sceneFile/files";

const temp = mkdtempSync(join(tmpdir(), "scenity-scene-file-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const SCENE = {
  format: "scenity.scene/1",
  id: "main",
  entities: {
    box: {
      parent: null,
      index: 0,
      components: { transform: { position: [1, 0, 0] }, "doors.panel": { width: 0.9 } },
    },
  },
};

let count = 0;

/** A temp project with `scenes/main.scene.json` in a loose (not canonical) form. */
function project(): string {
  count += 1;
  const dir = join(temp, `p${String(count)}`);
  mkdirSync(join(dir, "scenes"), { recursive: true });
  writeFileSync(join(dir, "scenes/main.scene.json"), JSON.stringify(SCENE));
  return dir;
}

/** The scene with the box at another x, as loose JSON. */
function moved(x: number): string {
  const box = {
    ...SCENE.entities.box,
    components: { ...SCENE.entities.box.components, transform: { position: [x, 0, 0] } },
  };
  return JSON.stringify({ ...SCENE, entities: { box } }, null, 1);
}

describe("the scene files of a project", () => {
  test("a read gives the text and the SHA-256 of the bytes", () => {
    const dir = project();
    const file = readSceneFile(dir, "scenes/main.scene.json");
    expect(file.text).toBe(JSON.stringify(SCENE));
    expect(file.hash).toBe(sceneTextHash(readFileSync(join(dir, "scenes/main.scene.json"))));
    expect(() => readSceneFile(dir, "scenes/none.scene.json")).toThrow("no scene file");
  });

  test("a save writes the canonical form atomically and gives the new hash", () => {
    const dir = project();
    const base = readSceneFile(dir, "scenes/main.scene.json");
    const result = saveSceneFile(dir, { path: "scenes/main.scene.json", text: moved(1.25), baseHash: base.hash });
    if (!result.ok) throw new Error(JSON.stringify(result));
    const disk = readFileSync(join(dir, "scenes/main.scene.json"), "utf8");
    expect(result.changed).toBe(true);
    expect(disk).toBe(result.text);
    expect(result.hash).toBe(sceneTextHash(disk));
    // The canonical form has sorted keys, two spaces and a final newline. A read and a write give the same bytes.
    const again = readDocument(disk, "scene");
    expect(again.ok && writeDocument(again.doc)).toBe(disk);
    expect(disk.startsWith('{\n  "entities": {')).toBe(true);
    // The unknown component of a plugin stays as it was.
    expect(disk).toContain('"doors.panel": {\n          "width": 0.9');
    // No temp file stays in the folder.
    expect(readdirSync(join(dir, "scenes"))).toEqual(["main.scene.json"]);
    // The same text again writes nothing.
    const same = saveSceneFile(dir, { path: "scenes/main.scene.json", text: disk, baseHash: result.hash });
    expect(same).toMatchObject({ ok: true, changed: false, hash: result.hash });
  });

  test("a save refuses a file that changed on the disk after the load, unless force", () => {
    const dir = project();
    const base = readSceneFile(dir, "scenes/main.scene.json");
    writeFileSync(join(dir, "scenes/main.scene.json"), moved(7));
    const theirs = sceneTextHash(moved(7));
    const params = { path: "scenes/main.scene.json", text: moved(2), baseHash: base.hash };
    expect(saveSceneFile(dir, params)).toEqual({
      ok: false,
      path: "scenes/main.scene.json",
      conflict: true,
      hash: theirs,
    });
    expect(readFileSync(join(dir, "scenes/main.scene.json"), "utf8")).toBe(moved(7));
    expect(saveSceneFile(dir, { ...params, force: true })).toMatchObject({ ok: true, changed: true });
    // A new file needs the base hash null; a later file at the path is a conflict.
    const fresh = { path: "scenes/new.scene.json", text: moved(3), baseHash: null };
    expect(saveSceneFile(dir, fresh)).toMatchObject({ ok: true, changed: true });
    expect(saveSceneFile(dir, fresh)).toMatchObject({ ok: false, conflict: true });
  });

  test("a save refuses a bad path, a path of the denylist, a link out of the project and a bad document", () => {
    const dir = project();
    const base = readSceneFile(dir, "scenes/main.scene.json").hash;
    const refused = (path: string, text = moved(1), denied?: (path: string) => boolean) => {
      const result = saveSceneFile(dir, { path, text, baseHash: base }, denied === undefined ? {} : { denied });
      return result.ok || result.conflict ? null : result.reason;
    };
    expect(refused("../escape.scene.json")).toContain("no empty, . or .. part");
    expect(refused("/etc/x.scene.json")).toContain("relative to the project");
    expect(refused("scenes/main.json")).toContain(".scene.json");
    expect(refused("scenes/main.scene.json", moved(1), (path) => path.startsWith("scenes/"))).toContain("does not let");
    expect(refused("scenes/main.scene.json", "{")).toContain("does not read");
    expect(refused("scenes/main.scene.json", JSON.stringify({ ...SCENE, format: "scenity.project/1" }))).toContain(
      "does not read",
    );
    const outside = mkdtempSync(join(temp, "outside-"));
    symlinkSync(outside, join(dir, "linked"));
    expect(refused("linked/out.scene.json")).toContain("not in the project folder");
    writeFileSync(join(outside, "real.scene.json"), JSON.stringify(SCENE));
    symlinkSync(join(outside, "real.scene.json"), join(dir, "scenes/link.scene.json"));
    expect(refused("scenes/link.scene.json")).toContain("link out of the project");
  });

  test("the contract checks the path and the parameters of a save", () => {
    expect(sceneFilePathProblem("scenes/a.scene.json")).toBeNull();
    expect(sceneFilePathProblem(".scene.json")).not.toBeNull();
    expect(sceneFilePathProblem("a\\b.scene.json")).not.toBeNull();
    expect(isSceneSaveParams({ path: "a.scene.json", text: "{}", baseHash: null })).toBe(true);
    expect(isSceneSaveParams({ path: "a.scene.json", text: "{}", baseHash: "abc" })).toBe(false);
    expect(isSceneSaveParams({ path: "a.scene.json", text: "{}", baseHash: null, force: "yes" })).toBe(false);
    expect(canonicalSceneText(JSON.stringify(SCENE))).toMatchObject({ ok: true });
  });
});

describe("the sequence files of a project", () => {
  const SEQUENCE = {
    format: "scenity.sequence/1",
    id: "tour",
    scene: "main",
    duration: 2000,
    tracks: [{ kind: "transform", entity: "box", keys: [{ t: 0, position: [1, 0, 0] }] }],
  };

  test("a save writes the canonical sequence, refuses a conflict and a bad sequence, and gates the rules", () => {
    const dir = project();
    mkdirSync(join(dir, "sequences"));
    const path = "sequences/tour.sequence.json";
    writeFileSync(join(dir, path), JSON.stringify(SEQUENCE));
    const base = readSceneFile(dir, path);
    const keyed = { ...SEQUENCE, markers: { half: 1000 } };
    const result = saveSceneFile(dir, { path, text: JSON.stringify(keyed), baseHash: base.hash });
    expect(result).toMatchObject({ ok: true, changed: true });
    const disk = readFileSync(join(dir, path), "utf8");
    const read = readDocument(disk, "sequence");
    expect(read.ok && writeDocument(read.doc) === disk).toBe(true);
    expect(saveSceneFile(dir, { path, text: disk, baseHash: base.hash })).toMatchObject({ ok: false, conflict: true });
    const late = { ...SEQUENCE, markers: { late: 9000 } };
    const bad = saveSceneFile(dir, { path, text: JSON.stringify(late), baseHash: sceneTextHash(disk) });
    expect(bad.ok || bad.conflict ? "" : bad.reason).toContain("The sequence does not read");
    // A block rule of the sequence needs a result of the page, else a reason of the owner.
    const ruled = { ...SEQUENCE, rules: [{ id: "tour.gap", metric: "distance", args: {}, max: 1, level: "block" }] };
    const text = JSON.stringify(ruled);
    const blocked = saveSceneFile(dir, { path, text, baseHash: sceneTextHash(disk) });
    expect(blocked).toMatchObject({ ok: false, conflict: false, blocked: [{ id: "tour.gap" }] });
    const checks = {
      hash: sceneTextHash(text),
      verdicts: [{ id: "tour.gap", level: "block", status: "pass" }],
    } as const;
    expect(saveSceneFile(dir, { path, text, baseHash: sceneTextHash(disk), checks })).toMatchObject({ ok: true });
    expect(sceneFilePathProblem("sequences/a.sequence.json")).toBeNull();
    expect(sceneFilePathProblem("sequences/.sequence.json")).not.toBeNull();
  });
});
