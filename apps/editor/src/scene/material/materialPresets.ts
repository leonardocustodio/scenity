// SPDX-License-Identifier: Apache-2.0
/**
 * The material presets of the material editor: plastic, metal, wood, glass, rubber and ceramic as values of a material
 * document. A preset sets the values that the type of the material takes in one step (a glass gives its transmission
 * to a physical material only). The other values, the name and the maps stay.
 * Pure functions, no DOM.
 */
import { setMaterialValue } from "@scenity/editor-core";
import { MATERIAL_FIELDS, type MaterialDocument } from "@scenity/scene/schema/material";

/** A preset: its ID (its label is the Fluent message `material-preset-<id>`) and its values. */
export interface MaterialPreset {
  readonly id: string;
  readonly values: Readonly<Record<string, unknown>>;
}

export const MATERIAL_PRESETS: readonly MaterialPreset[] = [
  { id: "plastic", values: { colour: "#d84a3a", roughness: 0.4, metalness: 0, clearcoat: 0.3 } },
  { id: "metal", values: { colour: "#b8bcc2", roughness: 0.25, metalness: 1 } },
  { id: "wood", values: { colour: "#8a5a34", roughness: 0.7, metalness: 0 } },
  { id: "glass", values: { colour: "#e8f2f8", roughness: 0.05, metalness: 0, transmission: 1, ior: 1.5 } },
  { id: "rubber", values: { colour: "#222222", roughness: 0.95, metalness: 0 } },
  { id: "ceramic", values: { colour: "#f2efe8", roughness: 0.15, metalness: 0, clearcoat: 1 } },
];

/** The fields of every type (the type, the name and the maps have their own edits). */
const COMMON = new Set(["colour", "opacity", "alphaTest", "side"]);

/** The document with the values of a preset that its type takes. */
export function withMaterialPreset(doc: MaterialDocument, preset: MaterialPreset): MaterialDocument {
  const fields = new Set(MATERIAL_FIELDS[doc.type]);
  return Object.entries(preset.values)
    .filter(([key]) => COMMON.has(key) || fields.has(key))
    .reduce((next, [key, value]) => setMaterialValue(next, key, value), doc);
}
