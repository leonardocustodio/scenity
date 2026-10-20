// SPDX-License-Identifier: Apache-2.0
/**
 * The layout variants as candidates of the picker: the saved
 * layouts of the open checkout (`apps/editor/src/core/layouts/<name>.json`) and the variants of the last layout
 * search of the lab (the bridge event `variants`). Each is a tune candidate: its sheet comes from the shadow frame with
 * the layout values on the defaults, as any tune set of the picker.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LAYOUT_NAME, type LayoutVariantOffer } from "@scenity/bridge";
import type { PickCandidate } from "./protocol";
import { WEB_DIR } from "./runArgs";
import { layoutValues } from "./sceneEdit";

/** The folder of the layout files in a checkout (layoutFiles.ts `LAYOUTS_FOLDER` of the lab). */
export const LAYOUTS_DIR = join("apps", "editor", "src", "core", "layouts");

/** The tune text of the values of a layout file, or null for a file that is not a layout. */
function layoutTune(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const tunes = (value as { tunes?: unknown }).tunes;
  if (typeof tunes !== "object" || tunes === null || Array.isArray(tunes)) return null;
  const pairs = Object.entries(tunes as Record<string, unknown>).map(([path, number]) =>
    typeof number === "number" && Number.isFinite(number) ? `${path}:${String(number)}` : "",
  );
  const text = pairs.join(",");
  return pairs.includes("") || !layoutValues(text) ? null : text;
}

/** The saved layouts of a checkout as tune candidates (`layout-<name>`), in the order of their names. */
export function savedLayoutCandidates(checkout: string): PickCandidate[] {
  const folder = join(checkout, WEB_DIR, LAYOUTS_DIR);
  let names: string[];
  try {
    names = readdirSync(folder).filter((file) => file.endsWith(".json"));
  } catch {
    return [];
  }
  return names.sort().flatMap((file): PickCandidate[] => {
    const name = file.replace(/\.json$/, "");
    if (!LAYOUT_NAME.test(name)) return [];
    try {
      const value = JSON.parse(readFileSync(join(folder, file), "utf8")) as { doc?: unknown };
      const tune = layoutTune(value);
      if (tune === null) return [];
      const doc = typeof value.doc === "string" && value.doc !== "" ? `: ${value.doc}` : "";
      return [{ id: `layout-${name}`, label: `Layout ${name}${doc}`.slice(0, 120), kind: "tune", tune }];
    } catch {
      return [];
    }
  });
}

/** The variants of a layout search as tune candidates (`search-<seed>-v1` …). */
export function offeredCandidates(seed: number, variants: readonly LayoutVariantOffer[]): PickCandidate[] {
  return variants.map((item) => ({
    id: `search-${String(seed)}-${item.id}`,
    label: `Search ${String(seed)} ${item.id}: ${item.label}`.slice(0, 120),
    kind: "tune",
    tune: item.tune,
  }));
}
