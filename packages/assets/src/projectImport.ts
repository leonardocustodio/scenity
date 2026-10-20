// SPDX-License-Identifier: Apache-2.0
/**
 * The import of a file into a project. The asset browser of the editor
 * imports a dropped or chosen file with it, and the promote of a scratch or dropped model makes its project
 * asset with it:
 *
 * 1. the file goes into the import folder of the project (default `assets/sources`): first a temp file in
 *    `.scenity/tmp`, then a rename, so a watcher never sees half a file;
 * 2. the importer of its extension writes the record (`*.meta.json`) with a new asset ID;
 * 3. the import writes `.scenity/imports/<id>/` (a failed import is a warning: the record stays);
 * 4. the asset database reads the new files.
 *
 * The rights check stays: a file with no rights record of its own points to the rights record of the imports
 * (`rights/imports.yaml`). Its licence is not known and its web delivery is pending, so the release gate stops the
 * asset until the owner records its rights. The result says so.
 */
import { existsSync, mkdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { AssetDatabase } from "./database";
import type { IdSource } from "./ids";
import { defaultImporterRegistry, importAsset, writeNewRecord, type ImporterRegistry } from "./import/index";
import { systemIdSource } from "./system";
import type { AssetEntry } from "./types";

/** The default import folder, relative to the project folder. */
export const IMPORT_FOLDER = "assets/sources";
/** The default rights record of the imported files, relative to the project folder. */
export const IMPORT_RIGHTS = "rights/imports.yaml";
/** The folder of the temp files of an import (git ignores `.scenity/`). */
const TEMP_FOLDER = ".scenity/tmp";

/** The options of an import into a project. */
export interface ProjectImportOptions {
  /** The import folder, relative to the project folder (default `assets/sources`). It must be under an asset root. */
  readonly folder?: string;
  /** The rights record, relative to the project folder (default `rights/imports.yaml`). */
  readonly rights?: string;
  /**
   * The folder that each written path must be in after the links resolve (default: the project folder). A project
   * whose asset roots are outside its folder gives the checkout that holds them.
   */
  readonly bound?: string;
  /** The date of a new rights record (default: today). */
  readonly today?: string;
  /** The tags of the new record (default `["imported"]`). */
  readonly tags?: readonly string[];
  /** The settings of the importer of the file (default: none); the schema of the importer checks them. */
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly registry?: ImporterRegistry;
  readonly ids?: IdSource;
}

/** The rights state of an imported asset. */
export interface ImportRights {
  /** The rights record of the asset, relative to the project folder. */
  readonly record: string;
  /** True when the import wrote the rights record (it did not exist). */
  readonly created: boolean;
  /** True when the release gate stops the asset until the owner records its rights. */
  readonly blocked: boolean;
  /** One sentence for the owner. */
  readonly note: string;
}

/** The result of an import into a project. */
export type ProjectImportResult =
  | {
      readonly ok: true;
      readonly db: AssetDatabase;
      readonly entry: AssetEntry;
      /** The source and the record, relative to the project folder. */
      readonly source: string;
      readonly record: string;
      readonly rights: ImportRights;
      readonly warnings: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

/** True when `path` (absolute) is the folder `dir` or a path under it. */
function inside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !rel.includes(`..${sep}`));
}

/** The real path of the deepest part of `path` that exists. */
function realExisting(path: string): string {
  let at = path;
  while (!existsSync(at)) at = dirname(at);
  return realpathSync(at);
}

/** A project path in its clean form: "/" separators, no "./" parts. */
function cleanPath(path: string): string {
  return posix.normalize(path.split(sep).join("/")).replace(/\/$/, "");
}

/** Why an import cannot write into the project, or null. */
export function importRefusal(
  db: AssetDatabase,
  options: Pick<ProjectImportOptions, "folder" | "rights" | "bound"> = {},
): string | null {
  const folder = cleanPath(options.folder ?? IMPORT_FOLDER);
  const underRoot = db.roots.some((root) => folder === root || folder.startsWith(`${root}/`));
  if (!underRoot) return `the folder ${folder} is not under an asset root of the project`;
  const bound = realpathSync(options.bound ?? db.dir);
  const rights = posix.dirname(cleanPath(options.rights ?? IMPORT_RIGHTS));
  for (const path of [folder, TEMP_FOLDER, rights]) {
    if (!inside(bound, realExisting(join(db.dir, path)))) return `the folder ${path} is outside the project`;
  }
  return null;
}

/**
 * The safe name of a file: the last part of the path, with each character other than a letter, a digit, ".", "-" or
 * "_" changed to "_". Null for a name that is empty or that starts with a dot.
 */
export function safeFileName(name: string): string | null {
  const last = name.split(/[\\/]/).pop() ?? "";
  const safe = last.normalize("NFC").replace(/[^\w.-]/g, "_");
  return safe === "" || safe.startsWith(".") ? null : safe;
}

/** A name in the import folder that no file and no record has yet: `name`, else `name-2`, `name-3` … */
function freeName(folder: string, name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const taken = (file: string) => existsSync(join(folder, file)) || existsSync(join(folder, `${file}.meta.json`));
  let file = name;
  for (let count = 2; taken(file); count += 1) file = `${stem}-${String(count)}${ext}`;
  return file;
}

/** The text of the rights record of the imported files. The licence of a dropped file is not known. */
export function importRightsText(today: string): string {
  return [
    "# The rights record of the files that the editor imports.",
    "# The licence of a dropped file is not known: the release gate stops each asset of this record.",
    "# Move each asset to a rights record with its real source and licence before a release.",
    "name: imports",
    'source: "Files that a user dropped or chose in the editor"',
    'author: "Not known"',
    'licence: "Not known: the owner reviews each file before a release"',
    `licenceDate: ${today}`,
    "allowedUse: [web]",
    "webDelivery: pending",
    "textReview: open",
    "",
  ].join("\n");
}

/** Write the file into the import folder through a temp file; the project path of the new source. */
function writeSource(dir: string, folder: string, name: string, bytes: Uint8Array): string {
  const target = join(dir, folder);
  mkdirSync(target, { recursive: true });
  mkdirSync(join(dir, TEMP_FOLDER), { recursive: true });
  const file = freeName(target, name);
  const temp = join(dir, TEMP_FOLDER, `${String(process.pid)}-${crypto.randomUUID()}-${file}`);
  writeFileSync(temp, bytes, { flag: "wx" });
  renameSync(temp, join(target, file));
  return `${folder}/${file}`;
}

/** Write the rights record of the imports when it does not exist; the rights state of the new asset. */
function importRights(dir: string, path: string, today: string): ImportRights {
  const file = join(dir, path);
  const created = !existsSync(file);
  if (created) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, importRightsText(today));
  }
  const note =
    `The rights record is ${path}: the licence is not known and the web delivery is pending, so the release gate ` +
    "stops the asset until the owner records its rights.";
  return { record: path, created, blocked: true, note };
}

/** Import a file (its name and bytes) into the project folder `dir`. A refusal is a result, not an error. */
export async function importProjectFile(
  dir: string,
  name: string,
  bytes: Uint8Array,
  options: ProjectImportOptions = {},
): Promise<ProjectImportResult> {
  const file = safeFileName(name);
  if (file === null) return { ok: false, reason: `"${name}" is not a file name that the project can hold` };
  const registry = options.registry ?? defaultImporterRegistry();
  const importer = registry.forFile(file);
  if (importer === undefined)
    return { ok: false, reason: `${file}: no importer reads this extension (${registry.extensions().join(", ")})` };
  // The settings must read with the schema of the importer before any file is written.
  const checked = importer.parseSettings(options.settings ?? {});
  if (!checked.ok) {
    const first = checked.errors[0];
    return {
      ok: false,
      reason: `the settings of ${importer.name} do not read: ${first?.path ?? ""} ${first?.message ?? ""}`.trim(),
    };
  }
  const db = await AssetDatabase.open(dir);
  const refusal = importRefusal(db, options);
  if (refusal !== null) return { ok: false, reason: refusal };
  const source = writeSource(dir, cleanPath(options.folder ?? IMPORT_FOLDER), file, bytes);
  const rightsPath = cleanPath(options.rights ?? IMPORT_RIGHTS);
  const rights = importRights(dir, rightsPath, options.today ?? new Date().toISOString().slice(0, 10));
  const record = writeNewRecord(dir, source, {
    registry,
    rights: rightsPath,
    tags: options.tags ?? ["imported"],
    ...(options.settings === undefined ? {} : { settings: options.settings }),
    ids: options.ids ?? systemIdSource,
  });
  const warnings: string[] = [];
  try {
    const { stamp } = await importAsset(dir, record, { registry });
    warnings.push(...stamp.warnings);
  } catch (error) {
    warnings.push(`the import failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  await db.update([source, record]);
  const entry = db.findByPath(record);
  if (entry === undefined) return { ok: false, reason: `${record} does not read` };
  return { ok: true, db, entry, source, record, rights, warnings };
}
