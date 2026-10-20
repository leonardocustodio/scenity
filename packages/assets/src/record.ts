// SPDX-License-Identifier: Apache-2.0
/**
 * The asset record `scenity.asset/1`: the `<source file>.meta.json` file beside each source.
 * The module has the zod schema, the reader with JSON Pointer errors and the writer. The writer is the canonical
 * writer of `@scenity/scene`.
 */
import {
  assetRefSchema,
  canonicalJson,
  formatString,
  isObject,
  parseFormat,
  parseRef,
  relativePathSchema,
  tagsSchema,
  textureCodecsSchema,
  zodErrors,
  type DocError,
} from "@scenity/scene";
import { z } from "zod";

/** The kind name of the record format. */
export const ASSET_RECORD_KIND = "asset";
/** The current major version of the record format. */
export const ASSET_RECORD_VERSION = 1;
export const ASSET_RECORD_FORMAT = "scenity.asset/1";
/** The suffix of a record file: the record of `chair.fbx` is `chair.fbx.meta.json`. */
export const RECORD_SUFFIX = ".meta.json";

/** The pattern of an asset ID: 10 to 26 letters, digits, `_` or `-`. A new ID is a ULID. */
export const ASSET_ID_RE = /^[0-9A-Za-z_-]{10,26}$/;
/** The built-in asset kinds. */
export const BUILTIN_ASSET_KINDS = [
  "model",
  "skinned-model",
  "animation",
  "texture",
  "material",
  "environment",
  "scene",
  "prefab",
  "audio",
] as const;
/** The pattern of a plugin kind: a plugin prefix, a dot and a name (`acme.clip-family`). */
export const PLUGIN_KIND_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

/** The pattern of a kind: a built-in kind or a plugin kind. */
const KIND_RE = new RegExp(`^(${BUILTIN_ASSET_KINDS.join("|")}|${PLUGIN_KIND_RE.source.slice(1, -1)})$`);

/** True when the text is a built-in kind or a plugin kind with a prefix. */
export function isAssetKind(kind: string): boolean {
  return KIND_RE.test(kind);
}

export const assetIdSchema = z.string().regex(ASSET_ID_RE, "an asset ID has 10 to 26 letters, digits, '_' or '-'");
export const assetKindSchema = z
  .string()
  .regex(KIND_RE, `a kind is ${BUILTIN_ASSET_KINDS.join(", ")} or a plugin kind with a prefix (acme.name)`);
const importerSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/, "an importer name has lower-case letters, digits, '-' and '.'");

/** The build settings of one asset: the texture codec of a role and the number of levels of detail. */
export const recordBuildSchema = z.strictObject({
  codecs: textureCodecsSchema.optional(),
  /** The number of levels of detail: the first levels of the project. */
  lods: z.number().int().min(1).max(8).optional(),
});

export const assetRecordSchema = z.strictObject({
  format: z.literal(ASSET_RECORD_FORMAT),
  id: assetIdSchema,
  kind: assetKindSchema,
  /** The source file, relative to the record. */
  source: relativePathSchema,
  /** The name of the importer. */
  importer: importerSchema,
  /** The import settings. The importer gives their schema; this record keeps them as an opaque object. */
  settings: z.record(z.string(), z.json()),
  /** The path of the rights record, relative to the record. */
  rights: relativePathSchema,
  tags: tagsSchema,
  /** The paths of the approval records, relative to the record. */
  approvals: z.array(relativePathSchema).optional(),
  /** The assets that this asset needs, as asset references (`asset:<id>`). */
  dependencies: z.array(assetRefSchema).optional(),
  /** The build settings of this asset: they replace the settings of the project for this asset. */
  build: recordBuildSchema.optional(),
  /**
   * The rig profile of a skinned model or a clip: a profile ID of `@scenity/character/profiles` (`ue5`,
   * `rigify`, `vrm`, `mixamo`), or `none` for a skeleton that plays its own clips only. With no value, the engine
   * finds the profile from the bone names.
   */
  rig: z
    .string()
    .regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/, "a rig profile ID has lower-case letters, digits, '-' and '.'")
    .optional(),
});

export type AssetRecord = z.infer<typeof assetRecordSchema>;

export type RecordReadResult =
  { readonly ok: true; readonly record: AssetRecord } | { readonly ok: false; readonly errors: readonly DocError[] };

/** Read an asset record from its text. Each error names the JSON Pointer of the bad value. */
export function readAssetRecord(text: string): RecordReadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return fail("", `the file is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return readAssetRecordValue(raw);
}

/** Read an asset record from a parsed JSON value (the same checks as `readAssetRecord`). */
export function readAssetRecordValue(raw: unknown): RecordReadResult {
  if (!isObject(raw)) return fail("", "an asset record is a JSON object");
  const format = parseFormat(raw.format);
  if (format?.kind !== ASSET_RECORD_KIND) return fail("/format", `the format is "${ASSET_RECORD_FORMAT}"`);
  if (format.version > ASSET_RECORD_VERSION) {
    const found = formatString(format.kind, format.version);
    return fail("/format", `this file has format ${found}; this Scenity reads up to /${String(ASSET_RECORD_VERSION)}`);
  }
  const parsed = assetRecordSchema.safeParse(raw);
  return parsed.success ? { ok: true, record: parsed.data } : { ok: false, errors: zodErrors(parsed.error) };
}

/** The canonical text of a record. The function checks the record first and throws on a bad record. */
export function writeAssetRecord(record: AssetRecord): string {
  const parsed = assetRecordSchema.safeParse(record);
  if (!parsed.success) {
    const errors = zodErrors(parsed.error).map((error) => `${error.path || "/"}: ${error.message}`);
    throw new Error(`not an asset record: ${errors.join("; ")}`);
  }
  return canonicalJson(parsed.data);
}

/** The asset IDs of the `dependencies` of a record, in record order. */
export function recordDependencies(record: AssetRecord): string[] {
  const ids: string[] = [];
  for (const text of record.dependencies ?? []) {
    const ref = parseRef(text);
    if (ref?.kind === "asset") ids.push(ref.id);
  }
  return ids;
}

/** The path of the record of a source file. */
export function recordPathFor(sourcePath: string): string {
  return sourcePath + RECORD_SUFFIX;
}

function fail(path: string, message: string): RecordReadResult {
  return { ok: false, errors: [{ path, message }] };
}
