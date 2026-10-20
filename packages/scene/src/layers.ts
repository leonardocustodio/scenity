// SPDX-License-Identifier: Apache-2.0
/**
 * Override layers: lists of ops on top of a scene. A layout variant, a per-pane value, a URL value and a proposal are
 * layers. The layers apply in the given order. The function refuses a layer for another scene. An op that does not
 * apply (for example, its entity is not there) gives a report entry, not a crash.
 */
import type { ComponentRegistry } from "./components/registry";
import { applyOps } from "./ops/apply";
import { diffDocuments } from "./ops/diff";
import { resolveFrom } from "./paths";
import type { OverridesDocument, SceneDocument } from "./schema/documents";
import type { SceneOp } from "./schema/entity";

/** One entry of the report of `applyLayers`. `op` is the index of the op in its layer. A refused layer has no `op`. */
export interface LayerReportEntry {
  readonly layer: number;
  readonly name?: string;
  readonly op?: number;
  readonly reason: string;
}

export interface LayersResult {
  readonly doc: SceneDocument;
  readonly report: readonly LayerReportEntry[];
}

/** Apply the layers in order. Each op applies alone: the function skips a bad op and applies the next op. */
export function applyLayers(
  scene: SceneDocument,
  layers: readonly OverridesDocument[],
  registry: ComponentRegistry,
): LayersResult {
  let doc = scene;
  const report: LayerReportEntry[] = [];
  layers.forEach((layer, index) => {
    const name = layer.name !== undefined ? { name: layer.name } : {};
    if (layer.scene !== scene.id) {
      report.push({ layer: index, ...name, reason: `the layer is for the scene "${layer.scene}", not "${scene.id}"` });
      return;
    }
    layer.ops.forEach((op, opIndex) => {
      const result = applyOps(doc, [op], registry);
      if (result.ok) doc = result.doc;
      else report.push({ layer: index, ...name, op: opIndex, reason: result.reason });
    });
  });
  return { doc, report };
}

/** An override layer from an op list. */
export function overridesOf(scene: string, ops: readonly SceneOp[], name?: string): OverridesDocument {
  return { format: "scenity.overrides/1", scene, ...(name !== undefined ? { name } : {}), ops: [...ops] };
}

/** "Save as variant": the layer that changes the base scene into the edited scene. */
export function variantFromDiff(base: SceneDocument, edited: SceneDocument, name?: string): OverridesDocument {
  return overridesOf(base.id, diffDocuments(base, edited), name);
}

/** The names of the variants of a scene, in sorted order. */
export function variantNames(scene: SceneDocument): string[] {
  return Object.keys(scene.variants ?? {}).sort();
}

/** The path of the override file of a variant, from the path of the scene file; undefined for an unknown name. */
export function variantPath(scene: SceneDocument, name: string, scenePath: string): string | undefined {
  const relative = scene.variants?.[name];
  return relative === undefined ? undefined : resolveFrom(scenePath, relative);
}
