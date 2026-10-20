// SPDX-License-Identifier: Apache-2.0
/**
 * The generic asset build. The caller gives a list of jobs. Each model job names its input, its budgets for each tier
 * and its optimize options. Each clip job names its input and its byte budget. The pipeline reads each input (the
 * bytes of the job, else `<exportFolder>/<id>.glb`). It optimizes each model for each level of detail (optimize.ts,
 * through the cache of cache.ts) and runs the generic checks (checks.ts). It gives the built files, the built models
 * and clips, and the findings. The caller adds its own checks and writes its manifest from the result.
 *
 * The build is deterministic: the same input gives the same bytes, so a check compares bytes (output.ts).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { clipProblems, modelTierProblems, type Finding, type TierBudget } from "./checks";
import type { ModelOptimizer } from "./cache";
import {
  gltfIO,
  modelStats,
  optimizeClip,
  optimizeModel,
  type ClipStats,
  type ModelStats,
  type OptimizeOptions,
  type Optimized,
} from "./optimize";
import { DEFAULT_LODS, type LodLevel, type ModelTier } from "./settings";

/** A model to build: one file for each level of detail, `<id>.<tier>.glb`. */
export interface ModelJob<E, T extends string = ModelTier> {
  readonly type: "model";
  readonly id: string;
  /** The entry of the caller: the pipeline returns it with the result. */
  readonly entry: E;
  /** The budget of each tier. A tier with no budget has no budget check. */
  readonly budgets: Readonly<Partial<Record<T, TierBudget>>>;
  /** The options of the optimize step. The triangle budget of each level comes from `budgets`. */
  readonly optimize?: Omit<OptimizeOptions, "triangles">;
  /** The levels of detail of this model (default: the levels of the pipeline). */
  readonly lods?: readonly LodLevel<T>[];
  /** The GLB bytes of the model (default: `<exportFolder>/<id>.glb`). */
  readonly input?: Uint8Array;
}

/** A clip to build: one file, `<id>.glb`. */
export interface ClipJob<E> {
  readonly type: "clip";
  readonly id: string;
  readonly entry: E;
  readonly maxBytes: number;
  readonly generator?: string;
  /** The GLB bytes of the clip (default: `<exportFolder>/<id>.glb`). */
  readonly input?: Uint8Array;
}

export type AssetJob<M, C, T extends string = ModelTier> = ModelJob<M, T> | ClipJob<C>;

export interface BuiltModel<E, T extends string = ModelTier> {
  readonly entry: E;
  /** The built file of each level of detail, by its tier. */
  readonly tiers: Readonly<Record<T, Optimized<ModelStats>>>;
}

export interface BuiltClip<E> {
  readonly entry: E;
  readonly built: Optimized<ClipStats>;
}

export interface PipelineOptions<M, C, T extends string = ModelTier> {
  readonly jobs: readonly AssetJob<M, C, T>[];
  /** The levels of detail of each model (default DEFAULT_LODS: `high` and `low`). */
  readonly lods?: readonly LodLevel<T>[];
  /** The folder of the exports: `<id>.glb` for each job without input bytes. */
  readonly exportFolder?: string;
  /** The folder of the built files (the check mode reads the committed files of a Git LFS pointer). */
  readonly builtFolder: string;
  /** The name of the asset list in the finding of an export without a job. */
  readonly listName: string;
  /** Check mode: an export that is a Git LFS pointer uses the committed built files (see committedModel). */
  readonly allowLfsPointers?: boolean;
  /** The cache of the optimized models (cache.ts), or none. */
  readonly cache?: ModelOptimizer;
  /** More glTF extensions that the loader of the project reads (default: the trimmed GLTFLoader only). */
  readonly extensions?: readonly string[];
}

export interface PipelineOutput<M, C, T extends string = ModelTier> {
  /** The built files by name, in the order of the jobs. */
  readonly files: Map<string, Uint8Array>;
  readonly models: readonly BuiltModel<M, T>[];
  readonly clips: readonly BuiltClip<C>[];
  /** The findings of the generic checks, in the order of the jobs (not sorted). */
  readonly findings: readonly Finding[];
}

/** True for a Git LFS pointer file (a checkout without the LFS files, for example in CI). */
export function isLfsPointer(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength < 1024 && new TextDecoder().decode(bytes.subarray(0, 40)).startsWith("version https://git-lfs")
  );
}

function readInput(job: { readonly id: string; readonly input?: Uint8Array }, folder: string | undefined): Uint8Array {
  if (job.input !== undefined) return job.input;
  if (folder === undefined)
    throw new Error(`no input for ${job.id}: the job has no bytes and there is no export folder`);
  const path = join(folder, `${job.id}.glb`);
  if (!existsSync(path)) throw new Error(`no export for ${job.id}: ${path} (export the master of the asset first)`);
  return new Uint8Array(readFileSync(path));
}

/**
 * A model whose export is a Git LFS pointer. The committed built files replace the build, so the checks also run on
 * them (budgets, textures, the checks of the caller). Only the check mode accepts this.
 */
async function committedModel<T extends string>(
  builtFolder: string,
  id: string,
  lods: readonly LodLevel<T>[],
  socketNames: readonly string[],
): Promise<Record<T, Optimized<ModelStats>>> {
  const io = await gltfIO();
  const tiers = {} as Record<T, Optimized<ModelStats>>;
  for (const { tier } of lods) {
    const path = join(builtFolder, `${id}.${tier}.glb`);
    if (!existsSync(path)) throw new Error(`${id}: the export is a Git LFS pointer and ${path} is missing`);
    const glb = new Uint8Array(readFileSync(path));
    tiers[tier] = { glb, plain: glb, stats: modelStats(await io.readBinary(glb), socketNames) };
  }
  return tiers;
}

async function buildModel<M, C, T extends string>(
  job: ModelJob<M, T>,
  input: Uint8Array,
  lods: readonly LodLevel<T>[],
  options: PipelineOptions<M, C, T>,
  findings: Finding[],
): Promise<Record<T, Optimized<ModelStats>>> {
  if (isLfsPointer(input)) {
    if (options.allowLfsPointers !== true) {
      throw new Error(`${job.id}: the export is a Git LFS pointer; run git lfs pull (${options.exportFolder ?? ""})`);
    }
    findings.push({
      level: "warning",
      asset: job.id,
      message: "the export is a Git LFS pointer: checked the built files",
    });
    return committedModel(options.builtFolder, job.id, lods, job.optimize?.socketNames ?? []);
  }
  const optimizer = options.cache ?? { optimize: optimizeModel };
  const tiers = {} as Record<T, Optimized<ModelStats>>;
  for (const level of lods) {
    const triangles = job.budgets[level.tier]?.triangles;
    const settings: OptimizeOptions = { ...job.optimize, ...(triangles === undefined ? {} : { triangles }) };
    tiers[level.tier] = await optimizer.optimize(input, level, settings);
  }
  return tiers;
}

/** Build every job in memory and run the generic checks. */
export async function runPipeline<M, C, T extends string = ModelTier>(
  options: PipelineOptions<M, C, T>,
): Promise<PipelineOutput<M, C, T>> {
  const files = new Map<string, Uint8Array>();
  const models: BuiltModel<M, T>[] = [];
  const clips: BuiltClip<C>[] = [];
  const known = new Set(options.jobs.map((job) => `${job.id}.glb`));
  const folder = options.exportFolder;
  const extra =
    folder !== undefined && existsSync(folder)
      ? readdirSync(folder).filter((name) => name.endsWith(".glb") && !known.has(name))
      : [];
  const findings: Finding[] = extra.map((name) => ({
    level: "error",
    asset: name,
    message: `an exported file without an entry in ${options.listName}`,
  }));
  const error = (asset: string, message: string): void => void findings.push({ level: "error", asset, message });
  const pipelineLods = options.lods ?? (DEFAULT_LODS as unknown as readonly LodLevel<T>[]);
  const extensions = options.extensions ?? [];

  for (const job of options.jobs) {
    const input = readInput(job, folder);
    if (job.type === "clip") {
      const built = await optimizeClip(input, job.generator);
      files.set(`${job.id}.glb`, built.glb);
      clips.push({ entry: job.entry, built });
      for (const problem of await clipProblems(built, job.maxBytes, extensions)) error(job.id, problem);
      continue;
    }
    const lods = job.lods ?? pipelineLods;
    const tiers = await buildModel(job, input, lods, options, findings);
    for (const { tier } of lods) {
      files.set(`${job.id}.${tier}.glb`, tiers[tier].glb);
      const budget = job.budgets[tier];
      for (const problem of await modelTierProblems(tier, tiers[tier], budget, extensions)) error(job.id, problem);
    }
    models.push({ entry: job.entry, tiers });
  }
  return { files, models, clips, findings };
}
