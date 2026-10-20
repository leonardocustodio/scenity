// SPDX-License-Identifier: Apache-2.0
/**
 * The test helpers of the importer registry: a temp project with the import fixtures and their records, and
 * the read of an imported model.
 */
import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Document } from "@gltf-transform/core";
import { getBounds } from "@gltf-transform/functions";
import { gltfIO } from "../src/build/optimize";
import { writeAssetRecord, type AssetRecord } from "../src/record";
import { put, record, tempProject } from "./helpers";

/** The folder of the import fixtures (blender/tests/make_import_fixtures.py makes them). */
export const IMPORT_FIXTURES = join(import.meta.dir, "fixtures", "import");

/** One fixture: the asset ID, the importer and the kind of its record. */
export const FIXTURES = {
  "box.gltf": { id: "01J9Z6Q3R9GLTF0000000000AA", importer: "gltf", kind: "model" },
  "box.glb": { id: "01J9Z6Q3R9GLB00000000000AA", importer: "glb", kind: "model" },
  "box.fbx": { id: "01J9Z6Q3R9FBX00000000000AA", importer: "fbx", kind: "model" },
  "box.obj": { id: "01J9Z6Q3R9QBJ00000000000AA", importer: "obj", kind: "model" },
  "tile.png": { id: "01J9Z6Q3R9PNG00000000000AA", importer: "png", kind: "texture" },
  "tile.jpg": { id: "01J9Z6Q3R9JPG00000000000AA", importer: "jpeg", kind: "texture" },
  "tile.webp": { id: "01J9Z6Q3R9WEBP0000000000AA", importer: "webp", kind: "texture" },
  "tile.avif": { id: "01J9Z6Q3R9AV1F0000000000AA", importer: "avif", kind: "texture" },
  "sky.hdr": { id: "01J9Z6Q3R9HDR00000000000AA", importer: "hdr", kind: "environment" },
} as const;

export type FixtureName = keyof typeof FIXTURES;

/** A temp project with each fixture file in `assets/` and a record for each fixture with the default settings. */
export function importProject(): string {
  const dir = tempProject();
  cpSync(IMPORT_FIXTURES, join(dir, "assets"), { recursive: true });
  put(dir, "rights.yaml", "licence: test\n");
  for (const name of Object.keys(FIXTURES) as FixtureName[]) writeRecord(dir, name);
  return dir;
}

/** Write the record of a fixture with more fields (for example other settings). Gives the record path. */
export function writeRecord(dir: string, name: FixtureName, fields: Partial<AssetRecord> = {}): string {
  const { id, importer, kind } = FIXTURES[name];
  const path = `assets/${name}.meta.json`;
  put(dir, path, writeAssetRecord(record(id, name, { importer, kind, rights: "../rights.yaml", ...fields })));
  return path;
}

/** The imported model of an output folder. */
export async function readModel(outDir: string): Promise<Document> {
  return (await gltfIO()).readBinary(readFileSync(join(outDir, "model.glb")));
}

/** The bounds of a model: the smallest and the largest corner. */
export function boundsOf(document: Document): { min: number[]; max: number[] } {
  const scene = document.getRoot().listScenes()[0];
  if (scene === undefined) throw new Error("no scene");
  return getBounds(scene);
}
