// SPDX-License-Identifier: Apache-2.0
/**
 * The types of manifest 2: the generic asset manifest of a build. The asset build of `@scenity/assets` writes it. The
 * run-time check is `parseAssetManifest` of `@scenity/runtime/manifest`. The module holds only types and one constant.
 * Thus the asset tools and the render workers share it with no other code.
 *
 * Each record is one asset: its ID, its kind, the built files with their sizes and SHA-256, the levels of detail with
 * the numbers that the budgets check, the facts of the build (`stats`) and the tags. A plugin finds its assets by
 * tags (for example `prop`, or `acme.slot:door`), not by a closed list of names.
 */

/** The format of manifest 2. */
export const ASSET_MANIFEST_FORMAT = "scenity.manifest/2";

/** One built file: its name in the output folder, its size and its SHA-256 (lowercase hex). */
export interface AssetFile {
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** One level of detail of a model: its tier, the name of its file in `files`, and the numbers of the budgets. */
export interface AssetLod {
  readonly tier: string;
  readonly file: string;
  readonly triangles: number;
  readonly meshes: number;
  /** The largest texture edge in pixels (0 without textures). */
  readonly maxTextureSize: number;
}

/** A fact of the build about an asset: a number, a flag, a text or a list of names. */
export type AssetStat = number | boolean | string | readonly string[];

/** One asset of a build. */
export interface AssetRecord {
  readonly id: string;
  /** A built-in kind (`model`, `skinned-model`, `animation`, `texture`, …) or a plugin kind with a prefix. */
  readonly kind: string;
  /** The levels of detail, from the full model to the smallest (empty for an asset with no levels). */
  readonly lods: readonly AssetLod[];
  /** Each built file of the asset. */
  readonly files: readonly AssetFile[];
  /** The sum of the bytes of the files. */
  readonly bytes: number;
  /** The SHA-256 of the file hashes, one per line: the version of the built asset. */
  readonly sha256: string;
  readonly stats: Readonly<Record<string, AssetStat>>;
  readonly tags: readonly string[];
  /** The IDs of the assets that this asset needs (for example, the textures of a material). Absent with no IDs. */
  readonly dependencies?: readonly string[];
}

/** The manifest of a build. */
export interface AssetManifest {
  readonly format: typeof ASSET_MANIFEST_FORMAT;
  /** The tiers of the levels of detail, from the full model to the smallest. */
  readonly tiers: readonly string[];
  readonly records: readonly AssetRecord[];
}

/** The limits of one tier. A missing value has no limit. */
export interface AssetLimits {
  readonly triangles?: number;
  readonly bytes?: number;
  readonly maxTextureSize?: number;
}

/**
 * The budgets by a key and then by tier, in the form of `quality.budgets` of the project document. A record takes the
 * budget of its first tag that has one, else the budget of its kind. A file that is not a level of detail takes the
 * byte limit of the first tier.
 */
export type AssetBudgets = Readonly<Record<string, Readonly<Record<string, AssetLimits>>>>;
