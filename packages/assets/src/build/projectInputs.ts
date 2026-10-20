// SPDX-License-Identifier: Apache-2.0
/**
 * The inputs of the build of a project. A model reads the output of the importer registry
 * (`.scenity/imports/<id>/model.glb`) when the import is current, else the source glTF or GLB file. A texture and an
 * environment map read their source file: their import is a copy of the bytes. The settings of a record come from the
 * schema of its importer, with the defaults.
 */
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { AssetEntry } from "../types";
import { DEFAULT_IMPORT_ROOT, importAsset, importKey, readImportStamp, resolveImport } from "../import/run";
import type { ImporterRegistry } from "../import/registry";
import type { Finding } from "./checks";
import { gltfIO } from "./optimize";

/** The options of the inputs: the importer registry, the import root and the import step. */
export interface InputOptions {
  readonly registry: ImporterRegistry;
  /** The output root of the imports, relative to the project folder (default `.scenity/imports`). */
  readonly importRoot?: string;
  /** Run the importer of each model first (default true). An import with the same key does nothing. */
  readonly runImports?: boolean;
}

/** The settings of a record with the defaults of its importer, or the error text of a bad record. */
export function recordSettings(
  entry: AssetEntry,
  registry: ImporterRegistry,
): { readonly settings: Readonly<Record<string, unknown>> } | { readonly error: string } {
  try {
    return { settings: resolveImport(registry, entry.record, entry.recordPath).settings };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** The GLB bytes of a glTF or GLB source file, or null for another format. */
async function sourceGlb(path: string): Promise<Uint8Array | null> {
  const extension = extname(path).toLowerCase();
  if (extension === ".glb") return new Uint8Array(readFileSync(path));
  if (extension !== ".gltf") return null;
  const io = await gltfIO();
  return io.writeBinary(await io.read(path));
}

/** True when the import of an entry has the current key of its record and its source. */
export function importIsCurrent(entry: AssetEntry, importDir: string, options: InputOptions): boolean {
  const stamp = readImportStamp(importDir);
  if (stamp === undefined || entry.hash === null) return false;
  try {
    const { importer, settings } = resolveImport(options.registry, entry.record, entry.recordPath);
    return stamp.key === importKey(importer, settings, entry.hash);
  } catch {
    return false;
  }
}

/** The GLB bytes of a model asset, or null after a finding that tells why there are none. */
export async function modelInput(
  dir: string,
  entry: AssetEntry,
  options: InputOptions,
  findings: Finding[],
): Promise<Uint8Array | null> {
  const outRoot = options.importRoot ?? DEFAULT_IMPORT_ROOT;
  const fail = (message: string): null => {
    findings.push({ level: "error", asset: entry.id, message });
    return null;
  };
  if (options.runImports !== false) {
    try {
      await importAsset(dir, entry.recordPath, { registry: options.registry, outRoot });
    } catch (error) {
      return fail(`the import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const importDir = join(resolve(dir, outRoot), entry.id);
  const imported = join(importDir, "model.glb");
  if (existsSync(imported) && importIsCurrent(entry, importDir, options)) return new Uint8Array(readFileSync(imported));
  if (existsSync(importDir)) {
    findings.push({
      level: "warning",
      asset: entry.id,
      message: "the import is not current: the build reads the source",
    });
  }
  if (entry.hash === null) return fail(`the source ${entry.sourcePath} does not exist`);
  const bytes = await sourceGlb(join(dir, entry.sourcePath));
  return bytes ?? fail(`${entry.sourcePath} is not glTF or GLB: import the asset first`);
}

/** The bytes of the source file of a texture or an environment map, or null after a finding. */
export function sourceBytes(dir: string, entry: AssetEntry, findings: Finding[]): Uint8Array | null {
  if (entry.hash !== null) return new Uint8Array(readFileSync(join(dir, entry.sourcePath)));
  findings.push({ level: "error", asset: entry.id, message: `the source ${entry.sourcePath} does not exist` });
  return null;
}
