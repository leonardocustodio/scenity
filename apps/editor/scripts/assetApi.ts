// SPDX-License-Identifier: Apache-2.0
/**
 * The asset list and the import of the asset browser, for the dev servers of the scene page and of the lab
 * (scripts/assetApiServer.ts answers the requests).
 *
 * - `listAssets` reads the asset database of a project (`@scenity/assets`). It gives each record with its kind, tags,
 *   numbers (the build manifest, else the source files), still and uses ("used by"). The still is
 *   `stills/<id>.webp`, else the source of a texture that a browser shows.
 * - `importFile` writes a dropped or chosen file into `assets/sources` of the project with `importProjectFile` of
 *   `@scenity/assets/projectImport`. It writes a temp file in `.scenity/tmp` first, then renames it, so the watcher
 *   never sees half a file. Then it writes the record (`*.meta.json`) and runs the import into
 *   `.scenity/imports/<id>/`. The record names the rights record `rights/imports.yaml`. That licence is open, so the
 *   release gate stops the asset until the owner reviews it.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import type { AssetDatabase, AssetEntry } from "@scenity/assets";
import type * as ImportIndex from "@scenity/assets/import";
import type * as AssetsIndex from "@scenity/assets";
import type * as RightsIndex from "@scenity/assets/rights";
import type * as ProjectImport from "@scenity/assets/projectImport";
import type * as ReleaseIndex from "@scenity/assets/release";
import { assetStatuses } from "@scenity/rules";
import type {
  AssetHealth,
  AssetImportResult,
  AssetList,
  AssetListEntry,
  AssetStats,
  ImportOptions,
  RightsInput,
  RightsWriteResult,
} from "../src/assetBrowser/assetTypes.ts";
import { assetsModule } from "./assetsModule.ts";

type DatabaseModule = { readonly AssetDatabase: typeof AssetDatabase };
type ProjectImportModule = typeof ProjectImport;
type ReleaseModule = typeof ReleaseIndex;

/** The folder of the imported files, relative to the project folder. */
export const IMPORT_FOLDER = "assets/sources";
/** The rights record of the imported files, relative to the project folder. */
export const IMPORT_RIGHTS = "rights/imports.yaml";
/** The folder of the stills (`DEFAULT_STILLS_DIR` of `@scenity/assets/stills`). */
const STILLS_FOLDER = "stills";
/** The source files that a browser shows as the still of a texture. */
const IMAGE_FILES = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"]);

/** The parts of a record of the build manifest (`scenity.manifest/2`) that the list reads. */
interface ManifestRecord {
  readonly id?: unknown;
  readonly bytes?: unknown;
  readonly lods?: readonly { readonly triangles?: unknown }[];
}

/** The records of the build manifest by asset ID; none when the project has no build. */
function manifestRecords(db: AssetDatabase): Map<string, ManifestRecord> {
  const path = join(db.dir, db.outputDir, "manifest.json");
  const out = new Map<string, ManifestRecord>();
  if (!existsSync(path)) return out;
  try {
    const manifest = JSON.parse(readFileSync(path, "utf8")) as { records?: readonly ManifestRecord[] };
    for (const record of manifest.records ?? []) if (typeof record.id === "string") out.set(record.id, record);
  } catch {
    // A manifest that does not read gives no numbers: the list takes the source files.
  }
  return out;
}

/** The numbers of an asset: the build record when there is one, else the size of the source files. */
function statsOf(dir: string, entry: AssetEntry, built: ManifestRecord | undefined): AssetStats {
  if (built !== undefined && typeof built.bytes === "number") {
    const triangles = built.lods?.[0]?.triangles;
    return {
      bytes: built.bytes,
      triangles: typeof triangles === "number" ? triangles : null,
      lods: built.lods?.length ?? 0,
    };
  }
  let bytes = 0;
  for (const file of entry.files) {
    const path = join(dir, file);
    if (existsSync(path)) bytes += statSync(path).size;
  }
  return { bytes, triangles: null, lods: 0 };
}

/** The still of an asset, relative to the project folder, or null. */
function stillOf(dir: string, entry: AssetEntry): string | null {
  const still = `${STILLS_FOLDER}/${entry.id}.webp`;
  if (existsSync(join(dir, still))) return still;
  const image = entry.kind === "texture" && IMAGE_FILES.has(extname(entry.sourcePath).toLowerCase());
  return image && entry.hash !== null ? entry.sourcePath : null;
}

/** The name of a tile: the source file name with no folder and no extension. */
function nameOf(sourcePath: string): string {
  const file = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

/** The list entry of an index entry. */
function listEntry(db: AssetDatabase, entry: AssetEntry, built: ManifestRecord | undefined): AssetListEntry {
  return {
    id: entry.id,
    kind: entry.kind,
    name: nameOf(entry.sourcePath),
    tags: [...entry.tags],
    source: entry.sourcePath,
    record: entry.recordPath,
    still: stillOf(db.dir, entry),
    stats: statsOf(db.dir, entry, built),
    usedBy: db.usedBy(entry.id).map((use) => ({
      document: use.document,
      pointer: use.pointer,
      ...(use.entity === undefined ? {} : { entity: use.entity }),
    })),
    problems: db
      .problems()
      .filter((problem) => problem.id === entry.id)
      .map((problem) => problem.message),
  };
}

/** The list entry of an index entry with no build numbers (a new import). */
export function listEntryOf(db: AssetDatabase, entry: AssetEntry): AssetListEntry {
  return listEntry(db, entry, undefined);
}

/** Why an import cannot write into the project, or null (`importRefusal` of `@scenity/assets/projectImport`). */
export async function importRefusal(db: AssetDatabase): Promise<string | null> {
  const { importRefusal: refusal } = await assetsModule<ProjectImportModule>("projectImport");
  return refusal(db);
}

/** Open the database of a project folder. */
async function openDatabase(dir: string): Promise<AssetDatabase> {
  const { AssetDatabase: Database } = await assetsModule<DatabaseModule>("");
  return Database.open(dir);
}

/**
 * The health of the assets of a project folder. It gives the assets that the release gate stops (their rights records,
 * as `scenity assets release-check`), and the assets of the database that the built manifest does not have.
 */
export async function assetHealth(dir: string): Promise<AssetHealth> {
  const db = await openDatabase(dir);
  const { releaseCheckOf } = await assetsModule<ReleaseModule>("release");
  const report = await releaseCheckOf(db);
  const built = manifestRecords(db);
  const ids = db.entries().map((entry) => entry.id);
  const rights = assetStatuses(ids, report.findings)
    .filter((status) => !status.allowed)
    .map((status) => ({ id: status.id, problems: status.problems }));
  return { rights, unbuilt: ids.filter((id) => !built.has(id)) };
}

/** The asset list of a project folder; `registry` has the importers of the project. */
export async function listAssets(dir: string, registry?: ImportIndex.ImporterRegistry): Promise<AssetList> {
  const db = await openDatabase(dir);
  const { defaultImporterRegistry } = await assetsModule<typeof ImportIndex>("import");
  const built = manifestRecords(db);
  const reason = await importRefusal(db);
  return {
    assets: db.entries().map((entry) => listEntry(db, entry, built.get(entry.id))),
    importable: reason === null,
    reason,
    extensions: (registry ?? defaultImporterRegistry()).extensions(),
  };
}

/**
 * The safe name of a file: the last part of the path, with each character other than a letter, a digit, ".", "-" or
 * "_" changed to "_". Null for a name that is empty or that starts with a dot. It is the rule of `safeFileName` of
 * `@scenity/assets/projectImport`, which the import applies. The server reads the name before the module loads.
 */
export function safeFileName(name: string): string | null {
  const last = name.split(/[\\/]/).pop() ?? "";
  const safe = last.normalize("NFC").replace(/[^\w.-]/g, "_");
  return safe === "" || safe.startsWith(".") ? null : safe;
}

/** The importers of the registry with the JSON Schema of their settings (the forms of the import dialog). */
export async function importerForms(registry?: ImportIndex.ImporterRegistry): Promise<unknown[]> {
  const { defaultImporterRegistry } = await assetsModule<typeof ImportIndex>("import");
  const { importerForms: forms } = await assetsModule<typeof AssetsIndex>("");
  return forms(registry ?? defaultImporterRegistry());
}

/** Write a new rights record into the project folder `dir`. */
export async function writeRights(dir: string, input: RightsInput): Promise<RightsWriteResult> {
  const { writeRightsRecord } = await assetsModule<typeof RightsIndex>("rights");
  return writeRightsRecord(dir, input);
}

/** The rights records of the project folder `dir`. */
export async function rightsRecords(dir: string): Promise<unknown[]> {
  const { rightsSummaries } = await assetsModule<typeof RightsIndex>("rights");
  return rightsSummaries(dir);
}

/** The options of an import (the settings, the rights record, the folder, and a date for a test). */
export interface ImportFileOptions extends ImportOptions {
  readonly today?: string;
  /** The importers of the project (default: the built-in importers). */
  readonly registry?: ImportIndex.ImporterRegistry;
}

/**
 * Import a file (its name and bytes) into the project folder `dir` with `importProjectFile` of `@scenity/assets`.
 * The promote of the workbench host uses the same steps.
 */
export async function importFile(
  dir: string,
  name: string,
  bytes: Uint8Array,
  options: ImportFileOptions = {},
): Promise<AssetImportResult> {
  const { importProjectFile } = await assetsModule<ProjectImportModule>("projectImport");
  const result = await importProjectFile(dir, name, bytes, {
    ...(options.registry === undefined ? {} : { registry: options.registry }),
    ...(options.today === undefined ? {} : { today: options.today }),
    ...(options.settings === undefined ? {} : { settings: options.settings }),
    ...(options.rights === undefined ? {} : { rights: options.rights }),
    ...(options.folder === undefined ? {} : { folder: options.folder }),
  });
  if (!result.ok) return result;
  const { db, entry, warnings, rights } = result;
  return {
    ok: true,
    asset: listEntry(db, entry, undefined),
    warnings,
    rights: { record: rights.record, note: rights.note },
  };
}
