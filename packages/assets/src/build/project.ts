// SPDX-License-Identifier: Apache-2.0
/**
 * The build of a Scenity project. The asset database gives the records; the project gives the settings
 * (settings.ts: the levels of detail, the codec of each texture role, the budgets of each kind and tier, the output
 * folder). Each asset kind has its build:
 *
 * - `model`, `skinned-model`: one GLB file for each level of detail, `<id>.<tier>.glb` (pipeline.ts);
 * - `animation`: one clip file, `<id>.glb`, with the byte budget of the first tier;
 * - `texture`: one KTX2 file, `<id>.ktx2`, with the codec of its role;
 * - `environment` (a Radiance HDR file): `<id>.hdr`, the bytes of the source (the codec `rgbe`);
 * - `audio` (a WAV, Ogg or MP3 file): `<id>.<ext>`, the bytes of the source, with the duration in seconds,
 *   the channels and the sample rate in the stats of the record;
 * - `material` (a material document): `<id>.material.json`, the canonical text of the document, with its
 *   texture assets in the `dependencies` of the record (material.ts).
 *
 * The other kinds have no built file. The build is deterministic: the same sources and settings give the same bytes.
 * The build also writes manifest 2 (`manifest.json` in the output folder): one record for each built asset, with the
 * tags of its asset record.
 */
import { join, resolve } from "node:path";
import { AssetDatabase } from "../database";
import { defaultImporterRegistry } from "../import/run";
import type { ImporterRegistry } from "../import/registry";
import { readTextureInfo } from "../import/textureInfo";
import { audioOutput } from "./audio";
import type { AssetEntry } from "../types";
import type { ModelOptimizer } from "./cache";
import { sortFindings, type Finding } from "./checks";
import { decodeImage } from "./images";
import { assetFile, assetManifest, manifestText, MANIFEST_FILE, modelOutputs, type AssetRecordDraft } from "./manifest";
import { materialOutput } from "./material";
import { runPipeline, type AssetJob, type PipelineOutput } from "./pipeline";
import { modelInput, recordSettings, sourceBytes, type InputOptions } from "./projectInputs";
import { resolveBuildSettings, resolveCodecs, type BuildSettings, type TextureRole } from "./settings";
import { encodeKtx2, fit } from "./textures";
import { GENERIC_GLTF_EXTENSIONS } from "./trimGltf";
import type { AssetManifest } from "@scenity/scene/manifest";

export interface ProjectBuildOptions {
  /** The cache of the optimized models (cache.ts), or none. */
  readonly cache?: ModelOptimizer;
  /** The importer registry (default: `defaultImporterRegistry()`). */
  readonly registry?: ImporterRegistry;
  /** The output root of the imports, relative to the project folder (default `.scenity/imports`). */
  readonly importRoot?: string;
  /** Run the importer of each model first (default true). False: read a current import, else the source. */
  readonly runImports?: boolean;
}

export interface ProjectBuildOutput {
  /** The ID of the project. */
  readonly project: string;
  readonly settings: BuildSettings;
  /** The absolute path of the output folder. */
  readonly outputDir: string;
  /** The built files by name, in sorted order, and the manifest file `manifest.json`. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** Manifest 2 of the build. */
  readonly manifest: AssetManifest;
  /** The names of the built files of each asset ID. */
  readonly outputs: ReadonlyMap<string, readonly string[]>;
  /** The findings: errors first. */
  readonly findings: readonly Finding[];
}

const MODEL_KINDS: ReadonlySet<string> = new Set(["model", "skinned-model"]);

/** The role of a texture asset from its import settings (`role`, `colorSpace`). */
function textureRole(settings: Readonly<Record<string, unknown>>): TextureRole {
  if (settings.role === "normal") return "normal";
  const colour = settings.role === "color" || settings.role === "emissive";
  return colour && settings.colorSpace !== "linear" ? "color" : "data";
}

/** The KTX2 file of a texture asset. */
async function textureFile(
  bytes: Uint8Array,
  entry: AssetEntry,
  settings: Readonly<Record<string, unknown>>,
  build: BuildSettings,
): Promise<Uint8Array> {
  const role = textureRole(settings);
  const image = await decodeImage(bytes);
  const maxSize = typeof settings.maxSize === "number" ? settings.maxSize : Number.POSITIVE_INFINITY;
  const first = build.lods[0]?.maxTextureSize[role] ?? Number.POSITIVE_INFINITY;
  const codecs = resolveCodecs(entry.record.build?.codecs, build.codecs);
  return encodeKtx2(fit(image, Math.min(maxSize, first), 0), codecs[role], role, settings.mipmaps !== false);
}

/** The built file of a texture or an environment asset, or null after a finding. */
async function imageOutput(
  dir: string,
  entry: AssetEntry,
  build: BuildSettings,
  options: InputOptions,
  findings: Finding[],
): Promise<readonly [string, Uint8Array] | null> {
  const error = (message: string): null => {
    findings.push({ level: "error", asset: entry.id, message });
    return null;
  };
  const read = recordSettings(entry, options.registry);
  if ("error" in read) return error(read.error);
  const bytes = sourceBytes(dir, entry, findings);
  if (bytes === null) return null;
  const hdr = readTextureInfo(bytes, "hdr");
  if (hdr !== null) {
    const maxSize = read.settings.maxSize;
    if (typeof maxSize === "number" && Math.max(hdr.width, hdr.height) > maxSize) {
      const message = `${String(hdr.width)} × ${String(hdr.height)} px is over ${String(maxSize)} px; the build keeps the size of an HDR map`;
      findings.push({ level: "warning", asset: entry.id, message });
    }
    return [`${entry.id}.hdr`, bytes];
  }
  if (entry.kind === "environment") return error("an environment map is a Radiance HDR file");
  try {
    return [`${entry.id}.ktx2`, await textureFile(bytes, entry, read.settings, build)];
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : String(cause));
  }
}

/** The pipeline job of a model or a clip asset, or null after a finding. */
async function assetJob(
  dir: string,
  entry: AssetEntry,
  build: BuildSettings,
  options: InputOptions,
  findings: Finding[],
): Promise<AssetJob<AssetEntry, AssetEntry, string> | null> {
  const input = await modelInput(dir, entry, options, findings);
  if (input === null) return null;
  const budgets = build.budgets[entry.kind] ?? {};
  if (!MODEL_KINDS.has(entry.kind)) {
    const tier = build.lods[0]?.tier ?? "";
    const maxBytes = budgets[tier]?.bytes ?? Number.POSITIVE_INFINITY;
    return { type: "clip", id: entry.id, entry, maxBytes, generator: build.generator, input };
  }
  const read = recordSettings(entry, options.registry);
  const sockets = "settings" in read ? read.settings.sockets : undefined;
  const socketNames = typeof sockets === "object" && sockets !== null ? Object.keys(sockets).sort() : [];
  const count = entry.record.build?.lods;
  return {
    type: "model",
    id: entry.id,
    entry,
    budgets,
    input,
    lods: count === undefined ? build.lods : build.lods.slice(0, count),
    optimize: {
      socketNames,
      generator: build.generator,
      codecs: resolveCodecs(entry.record.build?.codecs, build.codecs),
    },
  };
}

/** The problems of the asset database as findings: each problem stops a build. */
function databaseFindings(db: AssetDatabase): Finding[] {
  return db.problems().map((problem) => ({
    level: "error",
    asset: problem.id ?? problem.file,
    message: `${problem.code}: ${problem.file}: ${problem.message}`,
  }));
}

/** The record drafts of the built assets of a project, in the order of the asset database. */
function projectDrafts(
  entries: readonly AssetEntry[],
  built: PipelineOutput<AssetEntry, AssetEntry, string>,
  images: ReadonlyMap<string, Uint8Array>,
  tiers: readonly string[],
  stats: ReadonlyMap<string, AssetRecordDraft["stats"]>,
  dependencies: ReadonlyMap<string, readonly string[]>,
): AssetRecordDraft[] {
  const drafts: AssetRecordDraft[] = [];
  for (const entry of entries) {
    const base = { id: entry.id, kind: entry.kind, tags: entry.tags };
    const model = built.models.find((item) => item.entry === entry);
    const clip = built.clips.find((item) => item.entry === entry);
    const image = [...images].find(([name]) => name.startsWith(`${entry.id}.`));
    if (model !== undefined) {
      const own = tiers.filter((tier) => Object.hasOwn(model.tiers, tier));
      drafts.push({ ...base, ...modelOutputs(entry.id, own, model.tiers), stats: {} });
    } else if (clip !== undefined) {
      const files = [assetFile(`${entry.id}.glb`, clip.built.glb)];
      drafts.push({ ...base, lods: [], files, stats: { duration: clip.built.stats.duration } });
    } else if (image !== undefined) {
      const files = [assetFile(image[0], image[1])];
      const needs = dependencies.get(entry.id);
      drafts.push({
        ...base,
        lods: [],
        files,
        stats: stats.get(entry.id) ?? {},
        ...(needs ? { dependencies: needs } : {}),
      });
    }
  }
  return drafts;
}

/** Build each asset of a project in memory. */
export async function buildProject(projectDir: string, options: ProjectBuildOptions = {}): Promise<ProjectBuildOutput> {
  const dir = resolve(projectDir);
  const db = await AssetDatabase.open(dir);
  const settings = resolveBuildSettings(db.project);
  const inputs: InputOptions = {
    registry: options.registry ?? defaultImporterRegistry(),
    ...(options.importRoot === undefined ? {} : { importRoot: options.importRoot }),
    ...(options.runImports === undefined ? {} : { runImports: options.runImports }),
  };
  const findings = databaseFindings(db);
  const jobs: AssetJob<AssetEntry, AssetEntry, string>[] = [];
  const files = new Map<string, Uint8Array>();
  const stats = new Map<string, AssetRecordDraft["stats"]>();
  const dependencies = new Map<string, readonly string[]>();
  for (const entry of db.entries()) {
    if (MODEL_KINDS.has(entry.kind) || entry.kind === "animation") {
      const job = await assetJob(dir, entry, settings, inputs, findings);
      if (job !== null) jobs.push(job);
    } else if (entry.kind === "texture" || entry.kind === "environment") {
      const file = await imageOutput(dir, entry, settings, inputs, findings);
      if (file !== null) files.set(file[0], file[1]);
    } else if (entry.kind === "audio") {
      const sound = audioOutput(dir, entry, findings);
      if (sound !== null) {
        files.set(sound.file, sound.bytes);
        stats.set(entry.id, sound.stats);
      }
    } else if (entry.kind === "material") {
      const material = materialOutput(dir, entry, db, inputs.registry, findings);
      if (material !== null) {
        files.set(material.file, material.bytes);
        stats.set(entry.id, material.stats);
        dependencies.set(entry.id, material.dependencies);
      }
    }
  }
  const outputDir = join(dir, settings.output);
  const built = await runPipeline<AssetEntry, AssetEntry, string>({
    jobs,
    lods: settings.lods,
    builtFolder: outputDir,
    listName: "the asset records",
    // A project loads its models with the generic loader, so its built files can use each of its extensions.
    extensions: [...GENERIC_GLTF_EXTENSIONS, ...settings.extensions],
    ...(options.cache === undefined ? {} : { cache: options.cache }),
  });
  const tiers = settings.lods.map((lod) => lod.tier);
  const manifest = assetManifest(tiers, projectDrafts(db.entries(), built, files, tiers, stats, dependencies));
  for (const [name, bytes] of built.files) files.set(name, bytes);
  findings.push(...built.findings);
  const outputs = new Map<string, string[]>();
  for (const name of [...files.keys()].sort()) {
    const id = name.slice(0, name.indexOf("."));
    outputs.set(id, [...(outputs.get(id) ?? []), name]);
  }
  files.set(MANIFEST_FILE, new TextEncoder().encode(manifestText(manifest)));
  const sorted = new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return {
    project: db.project.id,
    settings,
    outputDir,
    files: sorted,
    manifest,
    outputs,
    findings: sortFindings(findings),
  };
}
