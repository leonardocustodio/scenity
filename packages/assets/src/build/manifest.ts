// SPDX-License-Identifier: Apache-2.0
/**
 * The writer of manifest 2: one record for each built asset, with its files, its levels of detail, the facts of the
 * build and its tags. The types are in `@scenity/scene/manifest`. The run-time check is `parseAssetManifest` of
 * `@scenity/runtime/manifest`. A project build (project.ts) writes the manifest of its assets. A content set with no
 * project file gives its own drafts (for example the content of a plugin).
 */
import {
  ASSET_MANIFEST_FORMAT,
  type AssetFile,
  type AssetLod,
  type AssetManifest,
  type AssetRecord,
  type AssetStat,
} from "@scenity/scene/manifest";
import { sha256 } from "./checks";
import type { ModelStats, Optimized } from "./optimize";

export type { AssetFile, AssetLod, AssetManifest, AssetRecord, AssetStat };

/** A record before the writer adds the sum of the bytes and the version hash. */
export interface AssetRecordDraft {
  readonly id: string;
  readonly kind: string;
  readonly lods: readonly AssetLod[];
  readonly files: readonly AssetFile[];
  readonly stats: Readonly<Record<string, AssetStat>>;
  readonly tags: readonly string[];
  /** The IDs of the assets that this asset needs. An empty list gives no field in the record. */
  readonly dependencies?: readonly string[];
}

/** The manifest file name in the output folder of a project build. */
export const MANIFEST_FILE = "manifest.json";

/** The file entry of built bytes. */
export function assetFile(file: string, bytes: Uint8Array): AssetFile {
  return { file, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

/** The level of detail of a built model file. */
export function assetLod(tier: string, file: string, stats: ModelStats): AssetLod {
  return { tier, file, triangles: stats.triangles, meshes: stats.meshes, maxTextureSize: stats.maxTextureSize };
}

/** The files and the levels of detail of a built model, one file for each tier: `<id>.<tier>.glb`. */
export function modelOutputs<T extends string>(
  id: string,
  tiers: readonly T[],
  built: Readonly<Record<T, Optimized<ModelStats>>>,
): { files: AssetFile[]; lods: AssetLod[] } {
  const files = tiers.map((tier) => assetFile(`${id}.${tier}.glb`, built[tier].glb));
  const lods = tiers.map((tier) => assetLod(tier, `${id}.${tier}.glb`, built[tier].stats));
  return { files, lods };
}

/** A record from its draft: the sum of the bytes and the SHA-256 of the file hashes (one per line). */
export function assetRecord(draft: AssetRecordDraft): AssetRecord {
  const bytes = draft.files.reduce((sum, item) => sum + item.bytes, 0);
  const version = sha256(new TextEncoder().encode(draft.files.map((item) => `${item.sha256}\n`).join("")));
  return {
    id: draft.id,
    kind: draft.kind,
    lods: draft.lods,
    files: draft.files,
    bytes,
    sha256: version,
    stats: draft.stats,
    tags: draft.tags,
    ...(draft.dependencies === undefined || draft.dependencies.length === 0
      ? {}
      : { dependencies: draft.dependencies }),
  };
}

/** The manifest of the records of a build, with the tiers of its levels of detail. */
export function assetManifest(tiers: readonly string[], drafts: readonly AssetRecordDraft[]): AssetManifest {
  return { format: ASSET_MANIFEST_FORMAT, tiers, records: drafts.map(assetRecord) };
}

/** The text of a manifest file: JSON with two spaces and a last new line. */
export function manifestText(manifest: AssetManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
