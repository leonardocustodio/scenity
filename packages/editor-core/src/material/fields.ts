// SPDX-License-Identifier: Apache-2.0
/**
 * The field model of the material editor. The widgets come from the JSON Schema of the material document
 * (`scenity.material/1`) through the widget model of the inspector: a colour, a number with its limits, an enum, a
 * switch, a vector. The hints here give the labels and the groups only. The type of a material gives its fields
 * (`MATERIAL_FIELDS`) and its texture slots (`MATERIAL_SLOTS_OF`). No Vue import, no DOM.
 */
import { documentJsonSchemas } from "@scenity/scene";
import type { FieldHint } from "@scenity/scene/components";
import {
  MATERIAL_FIELDS,
  MATERIAL_SLOTS_OF,
  type MaterialDocument,
  type MaterialSlot,
  type MaterialType,
} from "@scenity/scene/schema/material";
import { fieldLabel, objectFields, type FieldModel, type SchemaNode } from "../inspector/widgets";

/** The fields of every type that the editor shows as values (the type, the name and the maps have their own rows). */
const COMMON_VALUES = ["colour", "opacity", "alphaTest", "side"] as const;

/** The labels and the groups of the fields. A field with no label gets the label of its key. */
const HINTS: Readonly<Record<string, { readonly label?: string; readonly group: string }>> = {
  colour: { label: "Colour", group: "Surface" },
  roughness: { group: "Surface" },
  metalness: { group: "Surface" },
  opacity: { group: "Surface" },
  alphaTest: { group: "Surface" },
  side: { group: "Surface" },
  flatShading: { group: "Surface" },
  normalScale: { group: "Surface" },
  emissive: { label: "Emissive colour", group: "Emission" },
  emissiveIntensity: { label: "Emissive intensity", group: "Emission" },
  specular: { label: "Specular colour", group: "Phong" },
  shininess: { group: "Phong" },
  clearcoat: { label: "Clear coat", group: "Physical" },
  clearcoatRoughness: { label: "Clear coat roughness", group: "Physical" },
  sheen: { group: "Physical" },
  sheenColour: { label: "Sheen colour", group: "Physical" },
  sheenRoughness: { group: "Physical" },
  transmission: { group: "Physical" },
  thickness: { label: "Thickness (m)", group: "Physical" },
  ior: { label: "IOR", group: "Physical" },
  iridescence: { group: "Physical" },
  specularIntensity: { group: "Physical" },
  specularColour: { label: "Specular colour", group: "Physical" },
};

/**
 * The value that the runtime uses for a field that the document does not give (the defaults of three.js). The editor
 * shows it in place of an empty field. A reset removes the field from the document.
 */
export const MATERIAL_DEFAULTS: Readonly<Record<string, unknown>> = {
  colour: "#ffffff",
  opacity: 1,
  alphaTest: 0,
  side: "front",
  flatShading: false,
  emissive: "#000000",
  emissiveIntensity: 1,
  roughness: 1,
  metalness: 0,
  normalScale: [1, 1],
  clearcoat: 0,
  clearcoatRoughness: 0,
  sheen: 0,
  sheenColour: "#000000",
  sheenRoughness: 1,
  transmission: 0,
  thickness: 0,
  ior: 1.5,
  iridescence: 0,
  specularIntensity: 1,
  specularColour: "#ffffff",
  specular: "#111111",
  shininess: 30,
};

/** The labels of the texture slots. */
export const SLOT_LABELS: Readonly<Record<MaterialSlot, string>> = {
  colour: "Colour map",
  normal: "Normal map",
  roughness: "Roughness map",
  metalness: "Metalness map",
  emissive: "Emissive map",
  occlusion: "Occlusion map",
  alpha: "Alpha map",
};

/** The hints as inspector hints: a `custom` widget gives the widget of the schema. */
const FIELD_HINTS: Readonly<Record<string, FieldHint>> = Object.fromEntries(
  Object.entries(HINTS).map(([key, hint]) => [
    key,
    { widget: { kind: "custom", name: "schema" }, label: hint.label ?? fieldLabel(key), group: hint.group },
  ]),
);

let schema: SchemaNode | null = null;

/** The JSON Schema of the material document (made one time). */
export function materialSchema(): SchemaNode {
  schema ??= documentJsonSchemas().material;
  return schema;
}

/** The value fields of a material type, in the order of the hints: the common fields, then the fields of the type. */
export function materialFields(type: MaterialType): FieldModel[] {
  const keys = new Set<string>([...COMMON_VALUES, ...MATERIAL_FIELDS[type]]);
  const root = materialSchema();
  return objectFields(root, root, FIELD_HINTS).filter((field) => keys.has(field.key));
}

/** The texture slots of a material type. */
export function materialSlots(type: MaterialType): readonly MaterialSlot[] {
  return MATERIAL_SLOTS_OF[type];
}

/** The value of a field of a document, or its default when the document does not give it. */
export function materialValue(doc: MaterialDocument, key: string): unknown {
  const own = (doc as Readonly<Record<string, unknown>>)[key];
  return own === undefined ? MATERIAL_DEFAULTS[key] : own;
}
