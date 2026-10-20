// SPDX-License-Identifier: Apache-2.0
/**
 * The assets of `scenity check`: an asset source for the headless scene core.
 *
 * - A project with a build (`build.assets` in `scenity.project.json`) loads the built files of
 *   `<output>/manifest.json`, the LOD of the tier of the check. The check refuses a project whose manifest is missing
 *   (an error before any rule). A used asset with no record, a missing file, or a file whose size or SHA-256 is not the
 *   value of the manifest is stale: its load fails with the command that builds the project again.
 * - A project with no build loads the source files of the asset database, as the scene page does (the dev fallback).
 *
 * The metrics need no pixels: each image of a model is an empty texture, and a texture or an environment asset is an
 * empty texture too. Meshopt models decode with the decoder of three.js. A Draco model fails with the words of the
 * loader (the check has no Draco decoder).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { Texture } from "three";
import { GLTFLoader, type GLTFLoaderPlugin, type GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { AssetDatabase } from "@scenity/assets";
import type { ProjectDocument } from "@scenity/scene";
import { materialDocumentSchema } from "@scenity/scene/schema/material";
import { parseAssetManifest, type AssetBudgets } from "@scenity/runtime/manifest";
import { recordFile } from "@scenity/runtime/manifestAssets";
import type { AssetSource } from "./headless";

/** Where the assets come from: the built outputs, or the source files. */
export type AssetOrigin = "build" | "source";

/** A problem of the setup of a check (no project, no build): the check stops before any rule. */
export class CheckSetupError extends Error {
  override readonly name = "CheckSetupError";
}

/** The file of an asset, and its size and SHA-256 when a build gives them. */
interface AssetFileRef {
  readonly path: string;
  readonly bytes?: number;
  readonly sha256?: string;
}

/** The asset source of a check: it keeps the words of each failed load. */
export interface CheckAssets extends AssetSource {
  readonly origin: AssetOrigin;
  readonly tier: string;
  /** The folder of the built files or of the sources, relative to the project folder ("" for the sources). */
  readonly where: string;
  /** The words of each load that failed since the last `takeFailures`. */
  takeFailures(): string[];
}

/** A KHR_texture_basisu plugin with no transcoder: each image of a model is an empty texture. */
function emptyImages(parser: GLTFParser): GLTFLoaderPlugin {
  parser.loadImageSource = () => Promise.resolve(new Texture());
  return { name: "KHR_texture_basisu", loadTexture: (index: number) => parser.loadTextureImage(index, 0, {} as never) };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The command that builds a project again. */
function buildCommand(dir: string): string {
  const near = relative(process.cwd(), dir);
  return `bun packages/assets/src/cli.ts build ${near.startsWith("..") ? dir : near || "."}`;
}

/** The files of the built records by asset ID, for the LOD of a tier. */
function builtFiles(dir: string, project: ProjectDocument, output: string, tier: string): Map<string, AssetFileRef> {
  const file = join(dir, output, "manifest.json");
  if (!existsSync(file)) {
    throw new CheckSetupError(
      `The project has a build (build.assets) but no ${output}/manifest.json. Run: ${buildCommand(dir)}`,
    );
  }
  let manifest;
  try {
    manifest = parseAssetManifest(
      JSON.parse(readFileSync(file, "utf8")),
      project.quality?.budgets as AssetBudgets | undefined,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CheckSetupError(
      `The manifest ${output}/manifest.json does not read: ${reason}. Run: ${buildCommand(dir)}`,
    );
  }
  const out = new Map<string, AssetFileRef>();
  for (const record of manifest.records) {
    const name = recordFile(record, tier);
    const entry = record.files.find((item) => item.file === name);
    if (name === undefined || entry === undefined) continue;
    out.set(record.id, { path: join(dir, output, name), bytes: entry.bytes, sha256: entry.sha256 });
  }
  return out;
}

/** The source file of each asset record by asset ID (the dev fallback). */
async function sourceFiles(dir: string): Promise<Map<string, AssetFileRef>> {
  const db = await AssetDatabase.open(dir);
  return new Map(db.entries().map((entry) => [entry.id, { path: join(dir, entry.sourcePath) }]));
}

/** Parse a glTF or GLB file with empty images. The clips go with the scene (`Object3D.animations`). */
async function parseModel(path: string, bytes: Uint8Array): Promise<AssetSourceValue> {
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader();
  loader.register(emptyImages);
  loader.setMeshoptDecoder(MeshoptDecoder);
  const data = path.endsWith(".gltf")
    ? new TextDecoder().decode(bytes)
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await loader.parseAsync(data as ArrayBuffer, `${pathToFileURL(dirname(path)).href}/`);
  gltf.scene.animations = gltf.animations;
  return gltf.scene;
}

type AssetSourceValue = Awaited<ReturnType<AssetSource["load"]>>;

/** The value of an asset of a kind from the bytes of its file. */
async function assetValue(path: string, bytes: Uint8Array, kind: string, ref: string): Promise<AssetSourceValue> {
  if (kind === "model") return parseModel(path, bytes);
  if (kind === "material") {
    const parsed = materialDocumentSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    if (!parsed.success) throw new Error(`the material ${ref} is not valid: ${parsed.error.issues[0]?.message ?? ""}`);
    return { material: parsed.data };
  }
  return new Texture();
}

/**
 * The asset source of a project folder for a check at a tier (default "high"). It throws a `CheckSetupError` when the
 * project has a build and no manifest.
 */
export async function checkAssets(dir: string, project: ProjectDocument, tier = "high"): Promise<CheckAssets> {
  const output = project.build?.assets?.output;
  const origin: AssetOrigin = project.build?.assets === undefined ? "source" : "build";
  const where = origin === "build" ? (output ?? "build") : "";
  const files = origin === "build" ? builtFiles(dir, project, where, tier) : await sourceFiles(dir);
  const failures: string[] = [];
  const stale = `the build is stale. Run: ${buildCommand(dir)}`;
  const fileOf = (id: string): AssetFileRef => {
    const file = files.get(id);
    if (file === undefined) throw new Error(origin === "build" ? `the build has no ${id}: ${stale}` : "no record");
    if (!existsSync(file.path))
      throw new Error(`no file ${relative(dir, file.path)}${origin === "build" ? `: ${stale}` : ""}`);
    return file;
  };
  return {
    origin,
    tier,
    where,
    async load(ref, kind) {
      try {
        if (!ref.startsWith("asset:")) throw new Error("not an asset reference");
        const file = fileOf(ref.slice("asset:".length));
        const bytes = new Uint8Array(readFileSync(file.path));
        const changed = file.sha256 !== undefined && (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256);
        if (changed) throw new Error(`${relative(dir, file.path)} is not the file of the manifest: ${stale}`);
        return await assetValue(file.path, bytes, kind, ref);
      } catch (error) {
        failures.push(`${ref}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    },
    takeFailures: () => failures.splice(0),
  };
}
