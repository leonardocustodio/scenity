// SPDX-License-Identifier: Apache-2.0
/**
 * The documents of a project for the scene page: the scene document, read and checked with the reader of
 * `@scenity/scene`, and the asset manifest from the asset index of the project (`assets.index.json`,
 * scripts/projects.ts). The worker gets both in one "load" message and does not parse them again.
 */
import { builtinRegistry, readDocument, type SceneDocument } from "@scenity/scene";
import { ASSET_MANIFEST_FORMAT, type AssetManifest } from "@scenity/runtime/manifest";
import { t } from "../texts";

/** One entry of the asset index: the source file relative to the project, and the kind of the record. */
interface AssetIndexEntry {
  readonly path: string;
  readonly kind: string;
}

/** The scene document of a text, read and checked with the reader of `@scenity/scene`; it throws on a bad document. */
export function parseScene(text: string): SceneDocument {
  const result = readDocument(text, "scene", { registry: builtinRegistry() });
  if (!result.ok) throw new Error(result.errors.map((error) => `${error.path}: ${error.message}`).join("; "));
  return result.doc;
}

/**
 * The dev manifest of the project at `base` (records of `ASSET_MANIFEST_FORMAT`) and the URL of each file. Each entry
 * of the asset index gives one record with one file: its source file. A dev record has no LODs, no sizes and no
 * hashes. The size and hash checks apply to a built manifest only.
 */
export async function readManifest(
  base: string,
): Promise<{ readonly manifest: AssetManifest; readonly files: Readonly<Record<string, string>> }> {
  const response = await fetch(`${base}assets.index.json`);
  if (!response.ok) throw new Error(t("scene-error-no-index", { base, status: String(response.status) }));
  const index = (await response.json()) as Readonly<Record<string, AssetIndexEntry>>;
  const ids = Object.keys(index).sort();
  const files: Record<string, string> = {};
  const records = ids.map((id) => {
    const entry = index[id] ?? { path: "", kind: "model" };
    files[entry.path] = `${base}${entry.path}`;
    const file = { file: entry.path, bytes: 0, sha256: "" };
    return { id, kind: entry.kind, lods: [], files: [file], bytes: 0, sha256: "", stats: {}, tags: [] };
  });
  return { manifest: { format: ASSET_MANIFEST_FORMAT, tiers: [], records }, files };
}
