// SPDX-License-Identifier: Apache-2.0
/**
 * "Find a place" of the layout tools: the search of layoutSearch.ts for the first selected
 * entity, and its variants (the place, the move and the rules that pass) with Apply (one undo step). The script API
 * has the same: `layoutSearch(entity, radius)` and `applyPlace(variant)`.
 */
import type { Rule, SceneDocument } from "@scenity/scene";
import type { SceneInspectReport } from "@scenity/runtime-dev/document/report";
import { t } from "../../texts";
import { placeOp, searchPlaces, startResults } from "./layoutSearch";

/** One place of a search, for the script API and the list. */
export interface PlaceVariant {
  readonly id: string;
  readonly position: readonly number[];
  readonly move: number;
  readonly score: number;
  /** The status of each rule of the search at the place. */
  readonly results: Readonly<Record<string, string>>;
}

/** The result of a search. */
export interface PlaceSearchResult {
  readonly entity: string;
  readonly variants: readonly PlaceVariant[];
  readonly checked: number;
  readonly notes: readonly string[];
  /** The status of each rule of the search where the entity stands now, with its detail. */
  readonly start: Readonly<Record<string, string>>;
}

/** What the part reads of the page. */
export interface LayoutSearchParts {
  inspect(): Promise<SceneInspectReport | null>;
  settle(): Promise<void>;
  posed(): SceneDocument;
  rules(): readonly Rule[];
  selection(): readonly string[];
  apply(ops: readonly ReturnType<typeof placeOp>[], title: string): string | null;
  readonly project: Parameters<typeof searchPlaces>[0]["project"];
}

/** The search part: the button, the list and the script API. */
export function layoutSearchPart(parts: LayoutSearchParts) {
  const root = document.createElement("div");
  root.className = "scene-layout-search";
  root.dataset.testid = "layout-search";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = t("layout-search");
  button.title = t("layout-search-title");
  button.dataset.testid = "layout-search-run";
  const list = document.createElement("ul");
  list.dataset.testid = "layout-search-variants";
  root.append(button, list);
  let last: { entity: string; scenes: Map<string, SceneDocument>; result: PlaceSearchResult } | null = null;

  async function search(entity = parts.selection()[0], radius = 2): Promise<PlaceSearchResult | null> {
    if (entity === undefined) return null;
    await parts.settle();
    const report = await parts.inspect();
    if (report === null) return null;
    const input = { report, scene: parts.posed(), project: parts.project, rules: parts.rules(), entity, radius };
    const found = searchPlaces(input);
    const start = Object.fromEntries(startResults(input).map((item) => [item.id, `${item.status}: ${item.detail}`]));
    const scenes = new Map(found.variants.map((variant) => [variant.id, variant.scene]));
    const result: PlaceSearchResult = {
      entity,
      checked: found.checked,
      notes: found.notes,
      start,
      variants: found.variants.map((variant) => ({
        id: variant.id,
        position: placeOp(variant, entity).value,
        move: Math.round(variant.move * 1000) / 1000,
        score: Math.round(variant.score * 1000) / 1000,
        results: Object.fromEntries(variant.results.map((item) => [item.id, item.status])),
      })),
    };
    last = { entity, scenes, result };
    show(result);
    return result;
  }

  function apply(id: string): string | null {
    const scene = last?.scenes.get(id);
    if (last === null || scene === undefined) return t("layout-search-no-variant", { id });
    return parts.apply([placeOp({ scene }, last.entity)], t("layout-search-apply-title"));
  }

  function show(result: PlaceSearchResult): void {
    root.dataset.variants = String(result.variants.length);
    const rows = result.variants.map((variant) => {
      const item = document.createElement("li");
      item.dataset.variant = variant.id;
      const text = document.createElement("span");
      // The place, the move and the rule statuses are data values of the search.
      text.translate = false;
      const passed = Object.values(variant.results).filter((status) => status === "pass").length;
      text.textContent = `${variant.id}: ${variant.position.map((value) => value.toFixed(2)).join(", ")} · ${variant.move.toFixed(2)} m · ${String(passed)}/${String(Object.keys(variant.results).length)}`;
      const use = document.createElement("button");
      use.type = "button";
      use.textContent = t("layout-search-apply");
      use.dataset.testid = `layout-search-apply-${variant.id}`;
      use.addEventListener("click", () => void apply(variant.id));
      item.append(text, " ", use);
      return item;
    });
    if (rows.length === 0) {
      const none = document.createElement("li");
      none.textContent = t("layout-search-none");
      rows.push(none);
    }
    list.replaceChildren(...rows);
  }

  button.addEventListener("click", () => void search());
  return { element: root, search, apply };
}
