// SPDX-License-Identifier: Apache-2.0
/**
 * The test helpers of @scenity/assets: temp project folders with records, sources and a scene. Each test
 * removes its folders with `removeTemps`.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { canonicalJson } from "@scenity/scene";
import { writeAssetRecord, type AssetRecord } from "../src/record";

/** The folder of the showroom sample. */
export const SHOWROOM = join(import.meta.dir, "..", "..", "..", "samples", "showroom");

const temps: string[] = [];

/** A new empty temp folder. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "scenity-assets-"));
  temps.push(dir);
  return dir;
}

/** Remove each temp folder of the helpers. */
export function removeTemps(): void {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** A copy of the showroom sample in a temp folder. */
export function copyShowroom(): string {
  const dir = tempDir();
  cpSync(SHOWROOM, dir, { recursive: true });
  return dir;
}

/** Write a file and its folders. */
export function put(dir: string, path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}

/** A record with the default fields of a test. */
export function record(id: string, source: string, fields: Partial<AssetRecord> = {}): AssetRecord {
  return {
    format: "scenity.asset/1",
    id,
    kind: "model",
    source,
    importer: "glb",
    settings: {},
    rights: "rights.yaml",
    tags: [],
    ...fields,
  };
}

/** Write a source file and its record beside it. */
export function putAsset(dir: string, sourcePath: string, id: string, fields: Partial<AssetRecord> = {}): void {
  put(dir, sourcePath, `bytes of ${sourcePath}`);
  const name = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
  put(dir, `${sourcePath}.meta.json`, writeAssetRecord(record(id, name, fields)));
}

/** A scene with one entity for each asset ID: the entity `e<n>` has a model of the n-th ID. */
export function sceneText(ids: readonly string[]): string {
  const entities = Object.fromEntries(
    ids.map((id, index) => [
      `e${String(index)}`,
      { parent: null, index, components: { model: { asset: `asset:${id}` } } },
    ]),
  );
  return canonicalJson({ format: "scenity.scene/1", id: "main", name: "Main", entities });
}

/** A temp project with an asset root `assets` and a scene that uses the given asset IDs. */
export function tempProject(sceneIds: readonly string[] = []): string {
  const dir = tempDir();
  const project = {
    format: "scenity.project/1",
    id: "test",
    name: "Test",
    scenes: ["scenes/main.scene.json"],
    assets: ["assets"],
  };
  put(dir, "scenity.project.json", canonicalJson(project));
  put(dir, "scenes/main.scene.json", sceneText(sceneIds));
  return dir;
}
