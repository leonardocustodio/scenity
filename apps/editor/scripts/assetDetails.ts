// SPDX-License-Identifier: Apache-2.0
/**
 * The details of one asset and an import again, for the asset inspector of the scene page.
 *
 * - `assetDetails` reads the record, the import stamp (`.scenity/imports/<id>/import.json`) and the levels of detail
 *   of the build manifest.
 * - `reimportAsset` writes new settings into the record (when the call gives them), then imports the asset again with
 *   `importAsset` of `@scenity/assets/import` (`force`: the import runs also when the key does not change).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type * as AssetsIndex from "@scenity/assets";
import type * as ImportIndex from "@scenity/assets/import";
import type { AssetDetails, BuiltLod, ReimportInput, ReimportResult } from "../src/assetBrowser/assetTypes.ts";
import { assetsModule } from "./assetsModule.ts";

/** The parts of a record of the build manifest that the details read. */
interface ManifestRecord {
  readonly id?: unknown;
  readonly lods?: readonly { readonly tier?: unknown; readonly file?: unknown; readonly triangles?: unknown }[];
  readonly files?: readonly { readonly file?: unknown; readonly bytes?: unknown }[];
}

/** The levels of detail of an asset in the build manifest of the project (none: no build). The asset build panel reads them too. */
export function builtLods(dir: string, outputDir: string, id: string): BuiltLod[] {
  const path = join(dir, outputDir, "manifest.json");
  if (!existsSync(path)) return [];
  try {
    const manifest = JSON.parse(readFileSync(path, "utf8")) as { records?: readonly ManifestRecord[] };
    const record = manifest.records?.find((each) => each.id === id);
    const bytes = new Map((record?.files ?? []).map((file) => [file.file, file.bytes]));
    return (record?.lods ?? []).map((lod) => {
      const size = bytes.get(lod.file);
      return {
        tier: typeof lod.tier === "string" ? lod.tier : "",
        file: typeof lod.file === "string" ? lod.file : "",
        triangles: typeof lod.triangles === "number" ? lod.triangles : null,
        bytes: typeof size === "number" ? size : null,
      };
    });
  } catch {
    // A manifest that does not read gives no levels.
    return [];
  }
}

/** The details of the asset `id` of the project folder `dir`, or null for an ID that the database does not have. */
export async function assetDetails(dir: string, id: string): Promise<AssetDetails | null> {
  const { AssetDatabase } = await assetsModule<typeof AssetsIndex>("");
  const { readImportStamp, DEFAULT_IMPORT_ROOT } = await assetsModule<typeof ImportIndex>("import");
  const db = await AssetDatabase.open(dir);
  const entry = db.get(id);
  if (entry === undefined) return null;
  const record = JSON.parse(readFileSync(join(dir, entry.recordPath), "utf8")) as Record<string, unknown>;
  const outDir = join(dir, DEFAULT_IMPORT_ROOT, id);
  const stamp = readImportStamp(outDir);
  return {
    id,
    record,
    imported:
      stamp === undefined
        ? null
        : {
            importer: stamp.importer,
            settings: stamp.settings,
            warnings: stamp.warnings,
            report: stamp.report,
            files: stamp.files.map((file) => relative(dir, join(outDir, file)).split("\\").join("/")),
          },
    built: builtLods(dir, db.outputDir, id),
  };
}

/** Import the asset of `input.id` again, with the settings of the input when it gives them. */
export async function reimportAsset(
  dir: string,
  input: ReimportInput,
  registry?: ImportIndex.ImporterRegistry,
): Promise<ReimportResult> {
  const { AssetDatabase, readAssetRecord, writeAssetRecord } = await assetsModule<typeof AssetsIndex>("");
  const { importAsset } = await assetsModule<typeof ImportIndex>("import");
  const entry = (await AssetDatabase.open(dir)).get(input.id);
  if (entry === undefined) return { ok: false, reason: `no asset ${input.id}` };
  try {
    if (input.settings !== undefined) {
      const path = join(dir, entry.recordPath);
      const read = readAssetRecord(readFileSync(path, "utf8"));
      if (!read.ok) return { ok: false, reason: read.errors.map((error) => error.message).join("; ") };
      writeFileSync(
        path,
        writeAssetRecord({ ...read.record, settings: input.settings as AssetsIndex.AssetRecord["settings"] }),
      );
    }
    await importAsset(dir, entry.recordPath, { force: true, ...(registry === undefined ? {} : { registry }) });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const details = await assetDetails(dir, input.id);
  return details === null ? { ok: false, reason: `no asset ${input.id}` } : { ok: true, details };
}
