// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assetRecordJsonSchemaText, ASSET_SCHEMA_FILE } from "../src/jsonSchema";
import { isAssetKind, readAssetRecord, recordDependencies, writeAssetRecord } from "../src/record";
import { record, SHOWROOM } from "./helpers";

const ID = "01J9Z6Q3R9";

describe("the asset record", () => {
  test("a showroom record reads, and the writer gives the same bytes", () => {
    const path = join(SHOWROOM, "assets/sources/WoodenTable_01/WoodenTable_01_1k.gltf.meta.json");
    const text = readFileSync(path, "utf8");
    const read = readAssetRecord(text);
    if (!read.ok) throw new Error(JSON.stringify(read.errors));
    expect(read.record.kind).toBe("model");
    expect(writeAssetRecord(read.record)).toBe(text);
  });

  test("a full record reads, with dependencies and approvals", () => {
    const value = record(ID, "chair.fbx", {
      importer: "fbx",
      settings: { scale: 0.01, up: "y", origin: "base-centre", decimate: 0.5 },
      rights: "rights/kenney-furniture.yaml",
      tags: ["furniture"],
      approvals: ["approvals/chair.yaml"],
      dependencies: ["asset:01J9Z6Q3RA"],
    });
    const read = readAssetRecord(writeAssetRecord(value));
    expect(read.ok).toBe(true);
    if (read.ok) expect(recordDependencies(read.record)).toEqual(["01J9Z6Q3RA"]);
  });

  test("each error names the JSON Pointer of the bad value", () => {
    const bad = { ...record("short", "a.glb"), kind: "Thing", tags: ["ok", "no spaces"], extra: 1 };
    const read = readAssetRecord(JSON.stringify(bad));
    expect(read.ok).toBe(false);
    if (read.ok) return;
    const paths = read.errors.map((error) => error.path).sort();
    expect(paths).toEqual(["/extra", "/id", "/kind", "/tags/1"]);
  });

  test("a newer format and a bad JSON text are errors", () => {
    const newer = readAssetRecord(JSON.stringify({ ...record(ID, "a.glb"), format: "scenity.asset/2" }));
    expect(newer).toEqual({
      ok: false,
      errors: [{ path: "/format", message: "this file has format scenity.asset/2; this Scenity reads up to /1" }],
    });
    const notJson = readAssetRecord("{");
    expect(!notJson.ok && notJson.errors[0]?.path).toBe("");
  });

  test("a kind is a built-in kind or a plugin kind with a prefix", () => {
    for (const kind of ["model", "skinned-model", "texture", "environment", "acme.clip-family"]) {
      expect(isAssetKind(kind)).toBe(true);
    }
    for (const kind of ["Model", "clip-family", "acme.", ".x"]) expect(isAssetKind(kind)).toBe(false);
  });

  test("the writer refuses a bad record", () => {
    expect(() => writeAssetRecord(record("bad id!", "a.glb"))).toThrow(/\/id/);
  });

  test("the JSON Schema file is current", () => {
    const file = readFileSync(join(import.meta.dir, "..", "schema", ASSET_SCHEMA_FILE), "utf8");
    expect(file).toBe(assetRecordJsonSchemaText());
  });
});
