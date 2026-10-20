// SPDX-License-Identifier: Apache-2.0
/**
 * The import of an asset of a project. The record names the importer and holds the settings; the registry
 * gives the importer. The import key is the SHA-256 of the importer name, its version, the settings with their
 * defaults and the source hash (`hash.ts`). The output folder `<outRoot>/<id>/` keeps the key in `import.json`; an
 * import with the same key does nothing, and a change of the settings or of the source bytes imports again.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonicalJson, resolveFrom, type DocError } from "@scenity/scene";
import { runBlender } from "../blender/run";
import { readTextOrUndefined } from "../files";
import { hashSource, sha256 } from "../hash";
import { readAssetRecord, type AssetRecord } from "../record";
import { audioImporters } from "./audioImporters";
import { materialImporter } from "./materialImporter";
import { modelImporters } from "./modelImporters";
import { ImporterRegistry, isImporter, type BlenderRunner, type Importer } from "./registry";
import { textureImporters } from "./textureImporters";

/** The format of the stamp file `import.json`. */
export const IMPORT_STAMP_FORMAT = "scenity.import/1";
export const IMPORT_STAMP_FILE = "import.json";
/** The output root of the imports, relative to the project folder. A scan skips a folder that starts with `.`. */
export const DEFAULT_IMPORT_ROOT = ".scenity/imports";

/** The stamp of an import: the key, the inputs and the result. */
export interface ImportStamp {
  readonly format: typeof IMPORT_STAMP_FORMAT;
  readonly id: string;
  readonly importer: string;
  readonly version: number;
  readonly key: string;
  readonly sourceHash: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly files: readonly string[];
  readonly warnings: readonly string[];
  readonly report: Readonly<Record<string, unknown>>;
}

/** The result of `importAsset`. */
export interface ImportOutcome {
  /** "imported": the importer ran; "current": the stamp has the same key, so nothing ran. */
  readonly status: "imported" | "current";
  /** The output folder (absolute). */
  readonly outDir: string;
  readonly stamp: ImportStamp;
}

/** An import that cannot run: a bad record, an unknown importer, bad settings, a wrong kind or a missing source. */
export class ImportError extends Error {
  readonly errors: readonly DocError[];
  constructor(file: string, errors: readonly DocError[]) {
    super(`${file}: ${errors.map((error) => `${error.path || "/"}: ${error.message}`).join("; ")}`);
    this.name = "ImportError";
    this.errors = errors;
  }
}

export interface ImportOptions {
  /** The registry (default: `defaultImporterRegistry()`). */
  readonly registry?: ImporterRegistry;
  /** The output root (absolute, or relative to the project folder; default `.scenity/imports`). */
  readonly outRoot?: string;
  /** Import also when the stamp has the same key. */
  readonly force?: boolean;
  /** Run Blender (default: `runBlender` of `blender/run.ts`). */
  readonly blender?: BlenderRunner;
}

/**
 * A registry with the built-in importers: the models (glTF, GLB, FBX, OBJ, .blend), the textures, the sounds and the
 * material documents.
 */
export function defaultImporterRegistry(): ImporterRegistry {
  return new ImporterRegistry([...modelImporters(), ...textureImporters(), ...audioImporters(), materialImporter()]);
}

/**
 * The built-in importers and the importers of the plugins (the `importers` of their host faces). A value that
 * is not an importer, or an importer whose name or extension has an importer already, is left out with a warning.
 */
export function importerRegistryWith(
  extra: readonly unknown[],
  warn: (text: string) => void = () => undefined,
): ImporterRegistry {
  const registry = defaultImporterRegistry();
  for (const item of extra) {
    if (!isImporter(item)) {
      warn("a value of the importers of a plugin is not an importer");
      continue;
    }
    try {
      registry.register(item);
    } catch (error) {
      warn(`the importer ${item.name} of a plugin: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return registry;
}

/** The import key of an importer, its settings (with the defaults) and a source hash. */
export function importKey(importer: Importer, settings: Readonly<Record<string, unknown>>, sourceHash: string): string {
  return sha256(canonicalJson({ importer: importer.name, version: importer.version, settings, sourceHash }));
}

/** The stamp of an output folder, or undefined when it has none or the file does not read. */
export function readImportStamp(outDir: string): ImportStamp | undefined {
  const text = readTextOrUndefined(join(outDir, IMPORT_STAMP_FILE));
  if (text === undefined) return undefined;
  try {
    const stamp = JSON.parse(text) as Partial<ImportStamp>;
    return stamp.format === IMPORT_STAMP_FORMAT && typeof stamp.key === "string" ? (stamp as ImportStamp) : undefined;
  } catch {
    return undefined;
  }
}

function readRecord(projectDir: string, recordPath: string): AssetRecord {
  const text = readTextOrUndefined(join(projectDir, recordPath));
  if (text === undefined) throw new ImportError(recordPath, [{ path: "", message: "the record does not exist" }]);
  const read = readAssetRecord(text);
  if (!read.ok) throw new ImportError(recordPath, read.errors);
  return read.record;
}

/** The importer of a record and its settings with the defaults. Throws an ImportError for a bad record. */
export function resolveImport(
  registry: ImporterRegistry,
  record: AssetRecord,
  recordPath: string,
): { importer: Importer; settings: Readonly<Record<string, unknown>> } {
  const importer = registry.get(record.importer);
  if (importer === undefined) {
    const known = registry.list().map((item) => item.name);
    throw new ImportError(recordPath, [
      { path: "/importer", message: `no importer ${record.importer} (${known.join(", ")})` },
    ]);
  }
  if (!importer.kinds.includes(record.kind)) {
    const message = `the importer ${importer.name} makes ${importer.kinds.join(", ")}, not ${record.kind}`;
    throw new ImportError(recordPath, [{ path: "/kind", message }]);
  }
  const parsed = importer.parseSettings(record.settings);
  if (!parsed.ok) throw new ImportError(recordPath, parsed.errors);
  return { importer, settings: parsed.settings };
}

/** Import the asset of a record (a path relative to the project folder) when its import key changed. */
export async function importAsset(
  projectDir: string,
  recordPath: string,
  options: ImportOptions = {},
): Promise<ImportOutcome> {
  const record = readRecord(projectDir, recordPath);
  const { importer, settings } = resolveImport(options.registry ?? defaultImporterRegistry(), record, recordPath);
  const sourcePath = resolveFrom(recordPath, record.source);
  const source = hashSource(projectDir, sourcePath);
  if (source.hash === undefined || source.missing.length > 0) {
    const message = `the source files ${source.missing.join(", ")} do not exist`;
    throw new ImportError(recordPath, [{ path: "/source", message }]);
  }
  const key = importKey(importer, settings, source.hash);
  const outDir = join(resolve(projectDir, options.outRoot ?? DEFAULT_IMPORT_ROOT), record.id);
  const old = readImportStamp(outDir);
  if (old?.key === key && options.force !== true) return { status: "current", outDir, stamp: old };
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const result = await importer.run({
    id: record.id,
    kind: record.kind,
    source: resolve(projectDir, sourcePath),
    outDir,
    settings,
    blender: options.blender ?? runBlender,
  });
  const stamp: ImportStamp = {
    format: IMPORT_STAMP_FORMAT,
    id: record.id,
    importer: importer.name,
    version: importer.version,
    key,
    sourceHash: source.hash,
    settings,
    files: [...result.files],
    warnings: [...result.warnings],
    report: result.report,
  };
  // The stamp comes last: an import that fails leaves no stamp, so the next run imports again.
  writeFileSync(join(outDir, IMPORT_STAMP_FILE), canonicalJson(stamp));
  return { status: "imported", outDir, stamp };
}
