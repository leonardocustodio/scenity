// SPDX-License-Identifier: Apache-2.0
/**
 * The plan of the asset stills: the assets of a project that get a still, the file that the renderer draws
 * for each still, the input hash of each still and its state. The render needs a GPU, so the editor makes the pictures
 * (a renderer of `make.ts`); this module names no renderer and reads only files.
 *
 * - `model`, `skinned-model`: a framed view of the model. The input is the import (`.scenity/imports/<id>/model.glb`)
 *   when it is current, else the glTF or GLB source.
 * - `environment` (and a `texture` with an HDR source): a view of the map. The input is the source.
 * - `texture`: the image, scaled to the still. The input is the source.
 *
 * The other kinds have no still. The input hash covers the source hash, the importer and its settings and the SHA-256
 * of each build output of the asset. A change of one of them makes the still stale. The hash does not name the input
 * file: the imports are local files (`.scenity` is not in Git), so the state of a still is the same on each machine.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { canonicalJson } from "@scenity/scene";
import { importIsCurrent, recordSettings } from "../build/projectInputs";
import { AssetDatabase } from "../database";
import { sha256 } from "../hash";
import { DEFAULT_IMPORT_ROOT, defaultImporterRegistry } from "../import/run";
import type { ImporterRegistry } from "../import/registry";
import type { AssetEntry } from "../types";
import { readStillStamps, stillStatus, STILL_STAMP_FILE, type StillState } from "./stamps";

/** The view that a renderer draws for an asset. */
export type StillMode = "model" | "environment" | "texture";

/** The folder of the stills, relative to the project folder. */
export const DEFAULT_STILLS_DIR = "stills";
/** The file type of a still. */
export const STILL_EXTENSION = ".webp";
/** The size of a still in pixels (the size of the tiles of the content browser of the editor). */
export const STILL_SIZE = { width: 320, height: 240 } as const;

const MODEL_KINDS: ReadonlySet<string> = new Set(["model", "skinned-model"]);
const MODEL_FILES: ReadonlySet<string> = new Set([".gltf", ".glb"]);

/** The options of a plan. */
export interface StillPlanOptions {
  /** The version of the renderer: a still that another version made is stale. Undefined: do not compare it. */
  readonly renderer?: string;
  /** The importer registry (default: `defaultImporterRegistry()`). */
  readonly registry?: ImporterRegistry;
  /** The output root of the imports, relative to the project folder (default `.scenity/imports`). */
  readonly importRoot?: string;
  /** The folder of the stills, relative to the project folder (default `stills`). */
  readonly stillsDir?: string;
}

/** The still of one asset. */
export interface StillJob {
  readonly id: string;
  readonly kind: string;
  readonly mode: StillMode;
  /** The file that the renderer draws, relative to the project folder, or null when there is none. */
  readonly input: string | null;
  /** Why there is no file to draw, or null. */
  readonly problem: string | null;
  /** The input hash of the still now. */
  readonly inputs: string;
  /** The path of the still, relative to the project folder. */
  readonly still: string;
  readonly status: StillState;
  /** Why the still is not current, or null for a current still. */
  readonly reason: string | null;
}

/** The stills of a project. */
export interface StillsPlan {
  /** The absolute path of the project folder. */
  readonly dir: string;
  /** The folder of the stills, relative to the project folder. */
  readonly stillsDir: string;
  /** One job for each asset with a still, in the order of the IDs. */
  readonly jobs: readonly StillJob[];
  /** The still files of IDs that have no job, relative to the project folder. */
  readonly extra: readonly string[];
}

/** The mode of the still of an asset, or null for a kind with no still. */
export function stillMode(entry: Pick<AssetEntry, "kind" | "sourcePath">): StillMode | null {
  if (MODEL_KINDS.has(entry.kind)) return "model";
  if (entry.kind === "environment") return "environment";
  if (entry.kind !== "texture") return null;
  return extname(entry.sourcePath).toLowerCase() === ".hdr" ? "environment" : "texture";
}

/** The file that the renderer draws for an asset, or the reason why there is none. */
export function stillInput(
  dir: string,
  entry: AssetEntry,
  options: { readonly registry: ImporterRegistry; readonly importRoot?: string },
): { readonly file: string } | { readonly error: string } {
  if (entry.hash === null) return { error: `the source ${entry.sourcePath} does not exist` };
  if (stillMode(entry) !== "model") return { file: entry.sourcePath };
  const importDir = `${cleanPath(options.importRoot ?? DEFAULT_IMPORT_ROOT)}/${entry.id}`;
  const imported = `${importDir}/model.glb`;
  if (existsSync(join(dir, imported)) && importIsCurrent(entry, join(dir, importDir), options))
    return { file: imported };
  if (MODEL_FILES.has(extname(entry.sourcePath).toLowerCase())) return { file: entry.sourcePath };
  return { error: `${entry.sourcePath} is not glTF or GLB: import the asset first (cli.ts import)` };
}

/** The input hash of the still of an asset: the source, the import settings and the build outputs. */
export function stillInputHash(dir: string, entry: AssetEntry, registry: ImporterRegistry): string {
  const resolved = recordSettings(entry, registry);
  const settings = "settings" in resolved ? resolved.settings : entry.record.settings;
  const outputs = entry.outputs.map((file) => {
    const path = join(dir, file);
    return [file, existsSync(path) ? sha256(readFileSync(path)) : null];
  });
  return sha256(
    canonicalJson({ kind: entry.kind, hash: entry.hash, importer: entry.record.importer, settings, outputs }),
  );
}

/** The plan of the stills of an open asset database. */
export function planFromDatabase(db: AssetDatabase, options: StillPlanOptions = {}): StillsPlan {
  const registry = options.registry ?? defaultImporterRegistry();
  const stillsDir = cleanPath(options.stillsDir ?? DEFAULT_STILLS_DIR);
  const stamps = readStillStamps(join(db.dir, stillsDir, STILL_STAMP_FILE));
  const jobs: StillJob[] = [];
  for (const entry of db.entries()) {
    const mode = stillMode(entry);
    if (mode === null) continue;
    const found = stillInput(db.dir, entry, { registry, ...options });
    const input = "file" in found ? found.file : null;
    const problem = "error" in found ? found.error : null;
    const inputs = stillInputHash(db.dir, entry, registry);
    const still = `${stillsDir}/${entry.id}${STILL_EXTENSION}`;
    const exists = existsSync(join(db.dir, still));
    const state = stillStatus({ inputs, stamp: stamps[entry.id], exists, renderer: options.renderer });
    jobs.push({ id: entry.id, kind: entry.kind, mode, input, problem, inputs, still, ...state });
  }
  const ids = new Set(jobs.map((job) => job.id));
  const extra = stillFiles(join(db.dir, stillsDir))
    .filter((name) => !ids.has(name.slice(0, -STILL_EXTENSION.length)))
    .map((name) => `${stillsDir}/${name}`);
  return { dir: db.dir, stillsDir, jobs, extra };
}

/** The plan of the stills of a project folder. */
export async function planStills(projectDir: string, options: StillPlanOptions = {}): Promise<StillsPlan> {
  return planFromDatabase(await AssetDatabase.open(resolve(projectDir)), options);
}

/** A project path with no `./` at the start and no `/` at the end. */
function cleanPath(path: string): string {
  return path.replace(/^(\.\/)+/, "").replace(/\/+$/, "");
}

/** The names of the still files in a folder, sorted. */
function stillFiles(folder: string): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => name.endsWith(STILL_EXTENSION))
    .sort();
}
