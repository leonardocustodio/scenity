// SPDX-License-Identifier: Apache-2.0
/**
 * The reads of the asset browser: the search, the kind and tag filters, the
 * lists of the filters and the "used by" lines of an asset. No Vue, so the tests can read it.
 */
import { findReferences } from "@scenity/scene";
import { t } from "../texts";
import type { AssetListEntry, AssetUseInfo } from "./assetTypes";

/** The filters of the browser: a search text, and the kinds and the tags that the user picked (empty: all). */
export interface AssetFilters {
  readonly query: string;
  readonly kinds: ReadonlySet<string>;
  readonly tags: ReadonlySet<string>;
}

/** The text that the search reads for an asset. */
function searchText(asset: AssetListEntry): string {
  return [asset.name, asset.id, asset.kind, asset.source, ...asset.tags].join(" ").toLowerCase();
}

/**
 * The assets that pass the filters. Each word of the query must occur in the name, the ID, the kind, the source or a
 * tag. An asset passes the kind filter with one of the kinds, and the tag filter with one of the tags.
 */
export function filterAssets(assets: readonly AssetListEntry[], filters: AssetFilters): AssetListEntry[] {
  const words = filters.query.toLowerCase().split(/\s+/).filter(Boolean);
  return assets.filter((asset) => {
    if (filters.kinds.size > 0 && !filters.kinds.has(asset.kind)) return false;
    if (filters.tags.size > 0 && !asset.tags.some((tag) => filters.tags.has(tag))) return false;
    const text = searchText(asset);
    return words.every((word) => text.includes(word));
  });
}

/** The kinds of the assets, sorted, with no duplicate. */
export function kindsOf(assets: readonly AssetListEntry[]): string[] {
  return [...new Set(assets.map((asset) => asset.kind))].sort();
}

/** The tags of the assets, sorted, with no duplicate. */
export function tagsOf(assets: readonly AssetListEntry[]): string[] {
  return [...new Set(assets.flatMap((asset) => asset.tags))].sort();
}

/** The parts of a scene document that the "used by" lines read. */
export interface UseScene {
  readonly entities: Readonly<Record<string, { readonly name?: string | undefined; readonly components: unknown }>>;
}

/** The entities of a scene document that refer to an asset, in the order of their IDs. */
export function sceneUses(scene: UseScene, id: string): string[] {
  const out: string[] = [];
  for (const entityId of Object.keys(scene.entities).sort()) {
    const entity = scene.entities[entityId];
    if (entity === undefined) continue;
    const found = findReferences(entity.components).some(({ ref }) => ref.kind === "asset" && ref.id === id);
    if (found) out.push(entityId);
  }
  return out;
}

/** One line of the "used by" list. */
export interface UseLine {
  /** "scene": an entity of the open scene; "document": another document of the project. */
  readonly where: "scene" | "document";
  readonly text: string;
  /** The entity ID, for a line of the open scene. */
  readonly entity?: string;
  /** The path of the other document, for a line of another document. */
  readonly document?: string;
}

/**
 * The "used by" lines of an asset: first the entities of the open scene (from the document of the editor, so an edit
 * that is not saved counts), then the uses in the other documents of the project (from the asset database).
 */
export function useLines(
  asset: Pick<AssetListEntry, "id" | "usedBy">,
  open: { readonly path: string; readonly scene: UseScene } | null,
): UseLine[] {
  const lines: UseLine[] = [];
  if (open !== null) {
    for (const entity of sceneUses(open.scene, asset.id)) {
      const name = open.scene.entities[entity]?.name;
      lines.push({
        where: "scene",
        text: name === undefined || name === entity ? entity : `${name} (${entity})`,
        entity,
      });
    }
  }
  const others = asset.usedBy.filter((use: AssetUseInfo) => use.document !== open?.path);
  for (const use of others) {
    lines.push({
      where: "document",
      text: use.entity === undefined ? use.document : `${use.document} · ${use.entity}`,
      document: use.document,
    });
  }
  return lines;
}

/** A size in bytes as a short text (B, KB or MB). The unit is a Fluent message of assets.ftl. */
export function bytesText(bytes: number): string {
  if (bytes < 1024) return t("assets-size-bytes", { size: String(bytes) });
  if (bytes < 1024 * 1024) return t("assets-size-kilobytes", { size: (bytes / 1024).toFixed(0) });
  return t("assets-size-megabytes", { size: (bytes / (1024 * 1024)).toFixed(1) });
}
