// SPDX-License-Identifier: Apache-2.0
/**
 * The run-time check of manifest 2. The render worker loads the manifest of a build and checks it
 * with `parseAssetManifest` before a decoder reads a file. The types are in `@scenity/scene/manifest`; the JSON Schema
 * is `schema/manifest.schema.json`. The module has no zod, so the render workers stay small.
 */
import {
  ASSET_MANIFEST_FORMAT,
  type AssetBudgets,
  type AssetFile,
  type AssetLimits,
  type AssetLod,
  type AssetManifest,
  type AssetRecord,
  type AssetStat,
} from "@scenity/scene/manifest";

export {
  ASSET_MANIFEST_FORMAT,
  type AssetBudgets,
  type AssetFile,
  type AssetLimits,
  type AssetLod,
  type AssetManifest,
  type AssetRecord,
  type AssetStat,
};

export class AssetManifestError extends Error {
  override readonly name = "AssetManifestError";
}

type Json = Readonly<Record<string, unknown>>;

/** The patterns of `@scenity/scene` (ASSET_ID_PATTERN, TAG_PATTERN), copied: the worker does not load zod. */
const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const KIND = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;
const TAG = /^[A-Za-z0-9_.:-]{1,64}$/;
const TIER = /^[a-z][a-z0-9_-]{0,31}$/;
/** A built file name: no path parts and a known extension. The sound files of the asset build are wav, ogg or mp3. */
const FILE = /^[0-9A-Za-z_-]+(\.[0-9A-Za-z_-]+)*\.(glb|ktx2|hdr|webp|avif|png|json|wav|ogg|mp3)$/;
const SHA256 = /^[0-9a-f]{64}$/;

function fail(path: string, problem: string): never {
  throw new AssetManifestError(`manifest ${path}: ${problem}`);
}

function object(value: unknown, path: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "not an object");
  return value as Json;
}

/** Each item of a list through `map`, with the path of the item. */
function items<T>(value: unknown, path: string, map: (item: unknown, path: string) => T): T[] {
  if (!Array.isArray(value)) fail(path, "not a list");
  return value.map((item, index) => map(item, `${path}[${String(index)}]`));
}

function text(value: unknown, path: string, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) fail(path, "not a valid name");
  return value;
}

function count(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(path, "not a count");
  return value;
}

const tag = (value: unknown, path: string): string => text(value, path, TAG);

function stat(value: unknown, path: string): AssetStat {
  if (typeof value === "boolean" || typeof value === "string" || Number.isFinite(value)) return value as AssetStat;
  return items(value, path, tag);
}

function file(value: unknown, path: string): AssetFile {
  const json = object(value, path);
  return {
    file: text(json.file, `${path}.file`, FILE),
    bytes: count(json.bytes, `${path}.bytes`),
    sha256: text(json.sha256, `${path}.sha256`, SHA256),
  };
}

function lod(value: unknown, path: string, tiers: readonly string[]): AssetLod {
  const json = object(value, path);
  const tier = text(json.tier, `${path}.tier`, TIER);
  if (!tiers.includes(tier)) fail(path, `${tier} is not a tier`);
  return {
    tier,
    file: text(json.file, `${path}.file`, FILE),
    triangles: count(json.triangles, `${path}.triangles`),
    meshes: count(json.meshes, `${path}.meshes`),
    maxTextureSize: count(json.maxTextureSize, `${path}.maxTextureSize`),
  };
}

function over(path: string, value: number, limit: number | undefined): void {
  if (limit !== undefined && value > limit) fail(path, `${String(value)} is over the budget ${String(limit)}`);
}

/**
 * Refuse a file of the record over its budget, before any download or decode. The budget is the budget of the first
 * tag that has one, else the budget of the kind.
 */
function checkBudget(record: AssetRecord, path: string, tiers: readonly string[], budgets: AssetBudgets): void {
  const key = record.tags.find((item) => Object.hasOwn(budgets, item)) ?? record.kind;
  const budget = Object.hasOwn(budgets, key) ? budgets[key] : undefined;
  if (budget === undefined) return;
  for (const item of record.files) {
    const level = record.lods.find((entry) => entry.file === item.file);
    const limits = budget[level?.tier ?? tiers[0] ?? ""];
    over(`${path} ${item.file} bytes`, item.bytes, limits?.bytes);
    if (level === undefined) continue;
    over(`${path} ${item.file} triangles`, level.triangles, limits?.triangles);
    over(`${path} ${item.file} px`, level.maxTextureSize, limits?.maxTextureSize);
  }
}

function record(value: unknown, path: string, tiers: readonly string[]): AssetRecord {
  const json = object(value, path);
  const files = items(json.files, `${path}.files`, file);
  const lods = items(json.lods, `${path}.lods`, (item, at) => lod(item, at, tiers));
  for (const level of lods) {
    if (!files.some((item) => item.file === level.file)) fail(`${path}.lods`, `${level.file} is not in files`);
  }
  const bytes = count(json.bytes, `${path}.bytes`);
  if (bytes !== files.reduce((sum, item) => sum + item.bytes, 0)) fail(`${path}.bytes`, "not the sum of the files");
  const stats: Record<string, AssetStat> = {};
  for (const [key, item] of Object.entries(object(json.stats, `${path}.stats`))) {
    stats[key] = stat(item, `${path}.stats.${key}`);
  }
  const parsed: AssetRecord = {
    id: text(json.id, `${path}.id`, ID),
    kind: text(json.kind, `${path}.kind`, KIND),
    lods,
    files,
    bytes,
    sha256: text(json.sha256, `${path}.sha256`, SHA256),
    stats,
    tags: items(json.tags, `${path}.tags`, tag),
  };
  // The assets that the record needs (the textures of a material), when the record gives them.
  if (json.dependencies === undefined) return parsed;
  return {
    ...parsed,
    dependencies: items(json.dependencies, `${path}.dependencies`, (item, at) => text(item, at, ID)),
  };
}

/**
 * Check a manifest and return it typed. It throws an AssetManifestError for the first problem. With `budgets`, a file
 * over the budget of its record fails too.
 */
export function parseAssetManifest(value: unknown, budgets?: AssetBudgets): AssetManifest {
  const json = object(value, "");
  if (json.format !== ASSET_MANIFEST_FORMAT) fail("format", `not ${ASSET_MANIFEST_FORMAT}`);
  const tiers = items(json.tiers, "tiers", (item, path) => text(item, path, TIER));
  const ids = new Set<string>();
  const records = items(json.records, "records", (item, path) => {
    const parsed = record(item, path, tiers);
    if (ids.has(parsed.id)) fail(path, `${parsed.id} is in the manifest two times`);
    ids.add(parsed.id);
    if (budgets !== undefined) checkBudget(parsed, path, tiers, budgets);
    return parsed;
  });
  return { format: ASSET_MANIFEST_FORMAT, tiers, records };
}

/** The values of the tags `<prefix><value>` of a record, in tag order (for example the prefix `acme.slot:`). */
export function tagValues(record: AssetRecord, prefix: string): string[] {
  return record.tags.filter((tag) => tag.startsWith(prefix)).map((tag) => tag.slice(prefix.length));
}

/** The level of detail of a tier and its file, or null. */
export function lodOf(record: AssetRecord, tier: string): { lod: AssetLod; file: AssetFile } | null {
  const level = record.lods.find((entry) => entry.tier === tier);
  const found = level === undefined ? undefined : record.files.find((item) => item.file === level.file);
  return level === undefined || found === undefined ? null : { lod: level, file: found };
}
