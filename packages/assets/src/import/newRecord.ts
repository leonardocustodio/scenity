// SPDX-License-Identifier: Apache-2.0
/**
 * The record of a new source file: the importer of its extension, the first kind of that importer, empty
 * settings (the defaults apply) and a new asset ID.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { newAssetId, type IdSource } from "../ids";
import { recordPathFor, writeAssetRecord, type AssetRecord } from "../record";
import type { ImporterRegistry } from "./registry";

export interface NewRecordOptions {
  /** The settings of the importer (checked with its schema before the record is written). */
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly registry: ImporterRegistry;
  /** The path of the rights record, relative to the project folder. */
  readonly rights: string;
  /** The asset kind (default: the first kind of the importer). */
  readonly kind?: string;
  readonly tags?: readonly string[];
  readonly ids: IdSource;
}

/**
 * Write the record of a source file (a path relative to the project folder) and give its path. Throws when the record
 * exists already or when no importer reads the extension.
 */
export function writeNewRecord(projectDir: string, sourcePath: string, options: NewRecordOptions): string {
  const recordPath = recordPathFor(sourcePath);
  if (existsSync(join(projectDir, recordPath))) throw new Error(`${recordPath} exists already`);
  const importer = options.registry.forFile(sourcePath);
  if (importer === undefined) {
    throw new Error(`${sourcePath}: no importer reads this extension (${options.registry.extensions().join(", ")})`);
  }
  const folder = posix.dirname(sourcePath);
  const record: AssetRecord = {
    format: "scenity.asset/1",
    id: newAssetId(options.ids),
    kind: options.kind ?? importer.kinds[0] ?? "model",
    source: posix.basename(sourcePath),
    importer: importer.name,
    // The settings are JSON: the import options come from a schema of the importer.
    settings: { ...(options.settings ?? {}) } as AssetRecord["settings"],
    rights: posix.relative(folder, options.rights),
    tags: [...(options.tags ?? [])],
  };
  writeFileSync(join(projectDir, recordPath), writeAssetRecord(record));
  return recordPath;
}
