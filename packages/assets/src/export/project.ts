// SPDX-License-Identifier: Apache-2.0
/**
 * The glTF export of a scene of a project. `exportScene(projectDir, scene)` finds the scene by its ID or its
 * path, expands its prefabs, reads the model of each `model` component and gives one GLB file (writer.ts).
 *
 * A model reads the current import of its asset (`.scenity/imports/<id>/model.glb`), else its glTF or GLB source, as
 * the build does (build/projectInputs.ts). The export does not read the built files: their KTX2 textures and the
 * meshopt compression do not open in most tools.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  builtinRegistry,
  expandPrefabs,
  joinPath,
  parseRef,
  readDocument,
  resolveFrom,
  type PrefabDocument,
  type SceneDocument,
} from "@scenity/scene";
import type { Finding } from "../build/checks";
import { modelInput, type InputOptions } from "../build/projectInputs";
import { AssetDatabase } from "../database";
import { defaultImporterRegistry } from "../import/run";
import type { ImporterRegistry } from "../import/registry";
import { ModelFiles } from "./models";
import { sceneGlb, writeSceneGltf, type WrittenScene } from "./writer";

/** An export that cannot start: no scene with this ID or path, or a scene file that does not read. */
export class ExportError extends Error {
  override readonly name = "ExportError";
}

/** The options of an export. */
export interface ExportOptions {
  /** The importer registry (default: `defaultImporterRegistry()`). */
  readonly registry?: ImporterRegistry;
  /** Run the importer of each model first (default true). An import with the same key does nothing. */
  readonly runImports?: boolean;
  /** The `asset.generator` text of the glTF file. */
  readonly generator?: string;
}

/** The result of an export. */
export interface SceneExport extends WrittenScene {
  readonly glb: Uint8Array;
  /** The path of the scene file, relative to the project folder. */
  readonly sceneFile: string;
  /** The scene with each prefab expanded: the entity tree of the GLB file. */
  readonly scene: SceneDocument;
}

function readScene(dir: string, path: string): SceneDocument {
  const file = join(dir, path);
  if (!existsSync(file)) throw new ExportError(`${path} does not exist`);
  const read = readDocument(readFileSync(file, "utf8"), "scene");
  if (!read.ok) throw new ExportError(`${path}: ${read.errors.map((error) => error.message).join("; ")}`);
  return read.doc;
}

/** The path and the document of a scene: a path that ends in `.json`, else the ID of a scene of the project. */
export function findScene(db: AssetDatabase, scene: string): { path: string; doc: SceneDocument } {
  if (scene.endsWith(".json")) {
    const path = joinPath("", scene);
    return { path, doc: readScene(db.dir, path) };
  }
  const ids: string[] = [];
  for (const path of db.project.scenes) {
    if (!existsSync(join(db.dir, path))) continue;
    const doc = readScene(db.dir, path);
    if (doc.id === scene) return { path, doc };
    ids.push(doc.id);
  }
  throw new ExportError(`the project has no scene "${scene}" (scenes: ${ids.join(", ") || "none"})`);
}

/** A prefab resolver over the project files: `asset:<id>` through the asset database, else a relative path. */
function prefabResolver(db: AssetDatabase, scenePath: string, warn: (message: string) => void) {
  const paths = new Map<string, string>();
  const pathOf = (source: string, from: string | undefined): string | undefined => {
    const ref = parseRef(source);
    if (ref?.kind === "asset") return db.get(ref.id)?.sourcePath;
    const base = from === undefined ? scenePath : (paths.get(from) ?? pathOf(from, undefined));
    return base === undefined ? undefined : resolveFrom(base, source);
  };
  return (source: string, from: string | undefined): PrefabDocument | undefined => {
    const path = pathOf(source, from);
    if (path === undefined || !existsSync(join(db.dir, path))) return undefined;
    paths.set(source, path);
    const read = readDocument(readFileSync(join(db.dir, path), "utf8"), "prefab");
    if (read.ok) return read.doc;
    warn(`${path}: ${read.errors.map((error) => error.message).join("; ")}`);
    return undefined;
  };
}

/** The model reader of an export: the GLB bytes of a model asset, with a warning for each finding. */
function modelReader(db: AssetDatabase, options: InputOptions, warn: (message: string) => void) {
  return async (assetId: string): Promise<Uint8Array | null> => {
    const entry = db.get(assetId);
    if (entry === undefined) {
      warn(`asset:${assetId} has no record`);
      return null;
    }
    const findings: Finding[] = [];
    const bytes = await modelInput(db.dir, entry, options, findings);
    for (const finding of findings) warn(`asset:${assetId}: ${finding.message}`);
    return bytes;
  };
}

/** Export a scene of a project as one GLB file. Throws an `ExportError` when the scene is not found. */
export async function exportScene(
  projectDir: string,
  scene: string,
  options: ExportOptions = {},
): Promise<SceneExport> {
  const db = await AssetDatabase.open(projectDir);
  const found = findScene(db, scene);
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);
  const expanded = expandPrefabs(found.doc, prefabResolver(db, found.path, warn), builtinRegistry());
  for (const entry of expanded.report) warn(`${entry.entity}: ${entry.reason}`);
  const inputs: InputOptions = {
    registry: options.registry ?? defaultImporterRegistry(),
    runImports: options.runImports ?? true,
  };
  const files = new ModelFiles(modelReader(db, inputs, warn));
  const written = await writeSceneGltf(
    expanded.doc,
    files,
    options.generator === undefined ? {} : { generator: options.generator },
  );
  return {
    ...written,
    warnings: [...warnings, ...written.warnings],
    glb: await sceneGlb(written),
    sceneFile: found.path,
    scene: expanded.doc,
  };
}
