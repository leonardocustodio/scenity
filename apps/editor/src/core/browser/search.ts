// SPDX-License-Identifier: Apache-2.0
/**
 * The search and the filters of the content browser. The search examines each leaf of the tree. Each word of the text
 * must be in the key, the title, the subtitle or the catalog fields of the item ("hover", "P0 none", "alex.md loop").
 * A filter keeps the leaves with one value of a field.
 */
import { leavesOf, type BrowserItem, type BrowserTree } from "./tree";

/** The fields that a filter can name, and their values. */
export const FILTERS = {
  status: ["capture", "proc", "generic", "none"],
  priority: ["P0", "P1", "P2", "P3"],
  kind: ["loop", "stroke", "once", "in/hold/out", "pose", "add", "face"],
  layer: ["base", "upper", "add", "ik", "face"],
  scene: ["exact", "family", "none"],
} as const;

export type FilterField = keyof typeof FILTERS;
export type Filters = Partial<Record<FilterField, string>>;

/** The words of a leaf that the search examines (lower case). */
function haystack(item: BrowserItem): string {
  const clip = item.clip;
  const parts = [item.key, item.title, item.subtitle, item.owner ?? "", item.preset?.trigger ?? ""];
  if (clip !== undefined) {
    parts.push(
      clip.section,
      clip.family ?? "",
      clip.status,
      clip.priority ?? "",
      clip.kind ?? "",
      clip.title,
      clip.summary,
    );
    parts.push(...clip.layers);
  }
  return parts.join(" ").toLowerCase();
}

/** The value of a filter field for a leaf, or null. */
function fieldOf(item: BrowserItem, field: FilterField): readonly string[] {
  const clip = item.clip;
  switch (field) {
    case "status":
      return clip === undefined ? [] : [clip.status];
    case "priority":
      return [clip?.priority ?? item.preset?.priority ?? ""];
    case "kind":
      return clip?.kind == null ? [] : [clip.kind];
    case "layer":
      return clip?.layers ?? [];
    case "scene":
      return [item.scene === null ? "none" : item.scene.exact ? "exact" : "family"];
  }
}

/** True when the leaf has each value of the filters. */
export function passes(item: BrowserItem, filters: Filters): boolean {
  return Object.entries(filters).every(([field, value]) => fieldOf(item, field as FilterField).includes(value));
}

/** The leaves under `under` (all categories for none) that match the text and the filters, in the order of the tree. */
export function search(
  tree: BrowserTree,
  text: string,
  filters: Filters = {},
  under: readonly BrowserItem[] = tree.roots,
): BrowserItem[] {
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
  return leavesOf(under).filter((item) => {
    if (!passes(item, filters)) return false;
    const words_ = haystack(item);
    return words.every((word) => words_.includes(word));
  });
}

/** The filters as the text of the `filter` URL parameter ("status:none,priority:P0"), and back. */
export function filterText(filters: Filters): string {
  return Object.entries(filters)
    .filter(([, value]) => value !== "")
    .map(([field, value]) => `${field}:${value}`)
    .join(",");
}

export function parseFilters(text: string | null): Filters {
  const out: Filters = {};
  for (const part of (text ?? "").split(",")) {
    const [field, value] = part.split(":");
    if (field !== undefined && value !== undefined && field in FILTERS) {
      if ((FILTERS[field as FilterField] as readonly string[]).includes(value)) out[field as FilterField] = value;
    }
  }
  return out;
}
