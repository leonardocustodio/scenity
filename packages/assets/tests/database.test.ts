// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { AssetDatabase, ProjectReadError } from "../src/database";
import { writeAssetRecord } from "../src/record";
import { copyShowroom, put, putAsset, record, removeTemps, SHOWROOM, tempDir, tempProject } from "./helpers";

const TABLE = "01M4ZPXYG50NAV41FPDE38QB7E";
const A = "01J9Z6Q3R9AAAAAAAAAAAAAAAA";
const B = "01J9Z6Q3R9BBBBBBBBBBBBBBBB";

afterEach(removeTemps);

describe("the asset database of the showroom", () => {
  test("the scan indexes 7 assets with their kinds and no problem", async () => {
    const db = await AssetDatabase.open(SHOWROOM);
    const kinds = db.entries().map((entry) => entry.kind);
    expect(kinds.filter((kind) => kind === "model")).toHaveLength(6);
    expect(kinds.filter((kind) => kind === "environment")).toHaveLength(1);
    expect(db.problems()).toEqual([]);
    expect(db.missing()).toEqual([]);
  });

  test("an entry has the paths, the hash of the glTF files and the built files", async () => {
    const db = await AssetDatabase.open(SHOWROOM);
    const table = db.get(TABLE);
    expect(table?.sourcePath).toBe("assets/sources/WoodenTable_01/WoodenTable_01_1k.gltf");
    expect(table?.recordPath).toBe("assets/sources/WoodenTable_01/WoodenTable_01_1k.gltf.meta.json");
    expect(table?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(table?.files).toContain("assets/sources/WoodenTable_01/WoodenTable_01.bin");
    expect(table?.files).toContain("assets/sources/WoodenTable_01/textures/WoodenTable_01_diff_1k.jpg");
    expect(table?.outputs).toEqual([`build/${TABLE}.high.glb`, `build/${TABLE}.low.glb`]);
    expect(table?.tags).toEqual(["furniture"]);
  });

  test("usedBy lists the table asset in the entity table", async () => {
    const db = await AssetDatabase.open(SHOWROOM);
    const users = db.usedBy(TABLE);
    expect(users.filter((use) => use.document === "scenes/main.scene.json")).toEqual([
      {
        id: TABLE,
        document: "scenes/main.scene.json",
        pointer: "/entities/table/components/model/asset",
        entity: "table",
      },
    ]);
    // The crowd scene has 500 copies of the table.
    const crowd = users.filter((use) => use.document === "scenes/crowd.scene.json");
    expect(crowd).toHaveLength(500);
    expect(crowd).toContainEqual({
      id: TABLE,
      document: "scenes/crowd.scene.json",
      pointer: "/entities/table-00-00/components/model/asset",
      entity: "table-00-00",
    });
    // The effects scene is the showroom with the effect values, so it has one more table.
    expect(users.filter((use) => use.document === "scenes/effects.scene.json")).toHaveLength(1);
    expect(users).toHaveLength(502);
  });

  test("a change of a texture changes the hash of the glTF asset", async () => {
    const dir = copyShowroom();
    const db = await AssetDatabase.open(dir);
    const before = db.get(TABLE)?.hash;
    const texture = "assets/sources/WoodenTable_01/textures/WoodenTable_01_arm_1k.jpg";
    put(dir, texture, "new bytes");
    const change = await db.update([texture]);
    expect(change.ids).toEqual([TABLE]);
    expect(db.get(TABLE)?.hash).not.toBe(before);
  });
});

describe("a temp project", () => {
  test("a rename and a move of a source with its record keep the ID", async () => {
    const dir = tempProject([A]);
    putAsset(dir, "assets/chair.glb", A);
    const db = await AssetDatabase.open(dir);
    const hash = db.get(A)?.hash;
    mkdirSync(join(dir, "assets/furniture"));
    renameSync(join(dir, "assets/chair.glb"), join(dir, "assets/furniture/chair.glb"));
    renameSync(join(dir, "assets/chair.glb.meta.json"), join(dir, "assets/furniture/chair.glb.meta.json"));
    const change = await db.update(["assets/chair.glb", "assets/chair.glb.meta.json", "assets/furniture"]);
    expect(change.ids).toEqual([A]);
    expect(db.get(A)?.sourcePath).toBe("assets/furniture/chair.glb");
    expect(db.get(A)?.hash).toBe(hash);
    expect(db.problems()).toEqual([]);
    const reopened = await AssetDatabase.open(dir);
    expect(reopened.get(A)?.recordPath).toBe("assets/furniture/chair.glb.meta.json");
    expect(reopened.usedBy(A).map((use) => use.entity)).toEqual(["e0"]);
  });

  test("a moved folder keeps the IDs of its assets", async () => {
    const dir = tempProject([A]);
    putAsset(dir, "assets/old/chair.glb", A);
    const db = await AssetDatabase.open(dir);
    renameSync(join(dir, "assets/old"), join(dir, "assets/new"));
    await db.update(["assets/old", "assets/new"]);
    expect(db.get(A)?.sourcePath).toBe("assets/new/chair.glb");
    expect(db.entries()).toHaveLength(1);
  });

  test("a source that moved without its record is a problem with a hint", async () => {
    const dir = tempProject([A]);
    putAsset(dir, "assets/chair.glb", A);
    mkdirSync(join(dir, "assets/furniture"));
    renameSync(join(dir, "assets/chair.glb"), join(dir, "assets/furniture/chair.glb"));
    const db = await AssetDatabase.open(dir);
    const [problem] = db.problems();
    expect(problem?.code).toBe("missing-source");
    expect(problem?.file).toBe("assets/chair.glb.meta.json");
    expect(problem?.message).toContain("assets/furniture/chair.glb");
    expect(db.get(A)?.hash).toBeNull();
    expect(db.missing()).toEqual([]);
  });

  test("two records with the same ID are an error", async () => {
    const dir = tempProject();
    putAsset(dir, "assets/a.glb", A);
    putAsset(dir, "assets/b.glb", A);
    const db = await AssetDatabase.open(dir);
    expect(db.problems()).toEqual([
      expect.objectContaining({ code: "duplicate-id", file: "assets/b.glb.meta.json", id: A, pointer: "/id" }),
    ]);
    expect(db.get(A)?.recordPath).toBe("assets/a.glb.meta.json");
  });

  test("missing() reports a reference to an unknown asset with its pointer", async () => {
    const dir = tempProject([A, B]);
    putAsset(dir, "assets/a.glb", A);
    const db = await AssetDatabase.open(dir);
    expect(db.missing()).toEqual([
      { id: B, document: "scenes/main.scene.json", pointer: "/entities/e1/components/model/asset", entity: "e1" },
    ]);
    expect(db.problems().map((problem) => problem.code)).toEqual(["broken-reference"]);
  });

  test("a record dependency to an unknown asset is a broken reference", async () => {
    const dir = tempProject();
    putAsset(dir, "assets/a.glb", A, { dependencies: [`asset:${B}`] });
    putAsset(dir, "assets/c.glb", "01J9Z6Q3R9CCCCCCCCCCCCCCCC", { dependencies: [`asset:${A}`] });
    const db = await AssetDatabase.open(dir);
    expect(db.missing()).toEqual([{ id: B, document: "assets/a.glb.meta.json", pointer: "/dependencies/0" }]);
    expect(db.dependencies(A)).toEqual([B]);
    expect(db.dependents(A)).toEqual(["01J9Z6Q3R9CCCCCCCCCCCCCCCC"]);
    expect(db.usedBy(A)).toEqual([]);
  });

  test("a bad record and a missing glTF buffer are problems", async () => {
    const dir = tempProject();
    put(dir, "assets/bad.glb.meta.json", '{"format":"scenity.asset/1","id":"x"}');
    put(
      dir,
      "assets/m.gltf",
      JSON.stringify({ buffers: [{ uri: "m.bin" }], images: [{ uri: "data:image/png;base64,AA" }] }),
    );
    put(dir, "assets/m.gltf.meta.json", writeAssetRecord(record(B, "m.gltf", { importer: "gltf" })));
    const db = await AssetDatabase.open(dir);
    const codes = db.problems().map((problem) => `${problem.code} ${problem.file}`);
    expect(codes).toContain("missing-file assets/m.bin");
    expect(codes.filter((code) => code.startsWith("bad-record assets/bad.glb.meta.json")).length).toBeGreaterThan(0);
  });

  test("a scene that the project lists and that does not exist is a problem", async () => {
    const dir = tempProject();
    rmSync(join(dir, "scenes/main.scene.json"));
    const db = await AssetDatabase.open(dir);
    expect(db.problems()).toEqual([
      expect.objectContaining({ code: "missing-document", file: "scenes/main.scene.json" }),
    ]);
  });

  test("a folder with no project file does not open", async () => {
    const error = await AssetDatabase.open(tempDir()).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ProjectReadError);
  });
});
