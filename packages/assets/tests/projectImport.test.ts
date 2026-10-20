// SPDX-License-Identifier: Apache-2.0
// The import of a file into a project: the model in the import folder,
// its record through the importer, the import, the asset database, the rights record of the imports (licence not
// known: the release gate stops the asset), a free name for a second file, an import folder outside the project
// folder (the asset root of a checkout) and the refusals. Each write goes to a temp copy of the showroom.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { importProjectFile, importRefusal, IMPORT_RIGHTS, safeFileName } from "../src/projectImport";
import { AssetDatabase } from "../src/database";
import { releaseCheck } from "../src/release/index";
import { copyShowroom, removeTemps, tempDir } from "./helpers";
import { IMPORT_FIXTURES } from "./importHelpers";

afterAll(removeTemps);

const BOX = new Uint8Array(readFileSync(join(IMPORT_FIXTURES, "box.glb")));

describe("the import of a file into a project", () => {
  test("writes the model, its record and the rights record, imports it and updates the database", async () => {
    const dir = copyShowroom();
    const result = await importProjectFile(dir, "My Box.glb", BOX, { today: "2026-10-16", tags: ["promoted"] });
    if (!result.ok) throw new Error(result.reason);
    expect(result.source).toBe("assets/sources/My_Box.glb");
    expect(result.record).toBe("assets/sources/My_Box.glb.meta.json");
    expect(new Uint8Array(readFileSync(join(dir, result.source)))).toEqual(BOX);
    const record = JSON.parse(readFileSync(join(dir, result.record), "utf8")) as Record<string, unknown>;
    expect(record).toMatchObject({
      kind: "model",
      importer: "glb",
      rights: "../../rights/imports.yaml",
      tags: ["promoted"],
    });
    expect(result.entry).toMatchObject({ id: record.id, kind: "model", sourcePath: result.source });
    expect(existsSync(join(dir, ".scenity/imports", String(record.id)))).toBe(true);
    expect(result.rights).toMatchObject({ record: IMPORT_RIGHTS, created: true, blocked: true });
    const rights = readFileSync(join(dir, IMPORT_RIGHTS), "utf8");
    expect(rights).toContain("webDelivery: pending");
    expect(rights).toContain("licenceDate: 2026-10-16");
    // The rights check stays: the release gate of the showroom stops the new asset, and only it.
    const gate = await releaseCheck(dir);
    const errors = gate.findings.filter((finding) => finding.level === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((finding) => finding.assets.includes(String(record.id)))).toBe(true);
    const again = await AssetDatabase.open(dir);
    expect(again.get(String(record.id))?.sourcePath).toBe(result.source);
  });

  test("a second file of the same name gets a free name; the rights record stays", async () => {
    const dir = copyShowroom();
    const first = await importProjectFile(dir, "box.glb", BOX);
    const second = await importProjectFile(dir, "box.glb", BOX);
    if (!first.ok || !second.ok) throw new Error("an import failed");
    expect(second.source).toBe("assets/sources/box-2.glb");
    expect(second.entry.id).not.toBe(first.entry.id);
    expect(second.rights.created).toBe(false);
  });

  test("an import folder and a rights record under an asset root outside the project folder (a checkout)", async () => {
    const checkout = tempDir();
    const project = join(checkout, "samples/room");
    mkdirSync(project, { recursive: true });
    mkdirSync(join(checkout, "art/rights"), { recursive: true });
    const doc = { format: "scenity.project/1", id: "room", name: "Room", scenes: [], assets: ["../../art"] };
    writeFileSync(join(project, "scenity.project.json"), JSON.stringify(doc));
    const options = { folder: "../../art/imports/drop", rights: "../../art/rights/imports.yaml" };
    const db = await AssetDatabase.open(project);
    expect(importRefusal(db, options)).toBe("the folder ../../art/imports/drop is outside the project");
    expect(importRefusal(db, { ...options, bound: checkout })).toBeNull();
    const result = await importProjectFile(project, "box.glb", BOX, { ...options, bound: checkout });
    if (!result.ok) throw new Error(result.reason);
    expect(result.source).toBe("../../art/imports/drop/box.glb");
    expect(existsSync(join(checkout, "art/imports/drop/box.glb.meta.json"))).toBe(true);
    expect(readFileSync(join(checkout, "art/rights/imports.yaml"), "utf8")).toContain("webDelivery: pending");
    const record = JSON.parse(readFileSync(join(checkout, "art/imports/drop/box.glb.meta.json"), "utf8")) as {
      rights: string;
    };
    expect(record.rights).toBe("../../rights/imports.yaml");
  });

  test("refuses a bad name, an extension with no importer and a folder that no asset root holds", async () => {
    const dir = copyShowroom();
    expect(safeFileName(".hidden")).toBeNull();
    expect(await importProjectFile(dir, ".glb", BOX)).toMatchObject({ ok: false });
    expect(await importProjectFile(dir, "notes.txt", BOX)).toMatchObject({ ok: false });
    const refused = await importProjectFile(dir, "box.glb", BOX, { folder: "models" });
    expect(refused).toEqual({ ok: false, reason: "the folder models is not under an asset root of the project" });
  });
});
