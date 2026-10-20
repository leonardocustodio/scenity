// SPDX-License-Identifier: Apache-2.0
/**
 * The zod schema of the material document `*.material.json` (the asset kind `material`). A material document gives
 * the type of the material, its values and its textures. A texture reference names a texture asset by its ID and gives
 * the colour space of the pixels. The asset record beside the file gives the ID of the material. The document has no
 * ID of its own.
 *
 * Each type takes a set of values and texture slots (`MATERIAL_FIELDS`, `MATERIAL_SLOTS`). A value or a slot that
 * the type does not take is an error, so a document never holds a value that the runtime ignores.
 */
import { z } from "zod";
import { assetRefSchema, colourSchema, vec2Schema } from "./common";

/** The material types: the PBR materials, the Lambert and Phong materials and the unlit material. */
export const MATERIAL_TYPES = ["standard", "physical", "lambert", "phong", "unlit"] as const;
export type MaterialType = (typeof MATERIAL_TYPES)[number];

/** The colour spaces of the pixels of a texture: sRGB for colours, linear for data (as the texture importers). */
export const COLOUR_SPACES = ["srgb", "linear"] as const;
export type ColourSpace = (typeof COLOUR_SPACES)[number];

/** The texture slots of a material. */
export const MATERIAL_SLOTS = ["colour", "normal", "roughness", "metalness", "emissive", "occlusion", "alpha"] as const;
export type MaterialSlot = (typeof MATERIAL_SLOTS)[number];

/** The colour space of a slot when the reference gives none: sRGB for the colour slots, else linear. */
export const SLOT_COLOUR_SPACES: Readonly<Record<MaterialSlot, ColourSpace>> = {
  colour: "srgb",
  normal: "linear",
  roughness: "linear",
  metalness: "linear",
  emissive: "srgb",
  occlusion: "linear",
  alpha: "linear",
};

/** A texture reference: a texture asset, the colour space of its pixels, and the repeat and offset of its UVs. */
export const materialTextureSchema = z.strictObject({
  texture: assetRefSchema,
  /** The default comes from the slot (`SLOT_COLOUR_SPACES`). */
  colorSpace: z.enum(COLOUR_SPACES).optional(),
  repeat: vec2Schema.optional(),
  offset: vec2Schema.optional(),
});
export type MaterialTexture = z.infer<typeof materialTextureSchema>;

const unit = z.number().min(0).max(1);

export const materialDocumentSchema = z
  .strictObject({
    format: z.literal("scenity.material/1"),
    name: z.string().min(1).max(200).optional(),
    type: z.enum(MATERIAL_TYPES),
    colour: colourSchema.optional(),
    opacity: unit.optional(),
    /** A fragment with an alpha under this value is not drawn. */
    alphaTest: unit.optional(),
    side: z.enum(["front", "back", "double"]).optional(),
    flatShading: z.boolean().optional(),
    emissive: colourSchema.optional(),
    emissiveIntensity: z.number().min(0).optional(),
    roughness: unit.optional(),
    metalness: unit.optional(),
    /** The scale of the normal map in X and Y. */
    normalScale: vec2Schema.optional(),
    clearcoat: unit.optional(),
    clearcoatRoughness: unit.optional(),
    sheen: unit.optional(),
    sheenColour: colourSchema.optional(),
    sheenRoughness: unit.optional(),
    transmission: unit.optional(),
    /** The thickness of the volume in metres (with transmission). */
    thickness: z.number().min(0).optional(),
    ior: z.number().min(1).max(2.333).optional(),
    iridescence: unit.optional(),
    specularIntensity: unit.optional(),
    specularColour: colourSchema.optional(),
    /** The colour of the highlight of a Phong material. */
    specular: colourSchema.optional(),
    /** The size of the highlight of a Phong material: a higher value gives a smaller highlight. */
    shininess: z.number().min(0).optional(),
    maps: z.partialRecord(z.enum(MATERIAL_SLOTS), materialTextureSchema).optional(),
  })
  .superRefine((doc, ctx) => {
    const fields = MATERIAL_FIELDS[doc.type];
    for (const key of Object.keys(doc)) {
      if (!MATERIAL_COMMON_FIELDS.has(key) && !fields.includes(key)) {
        ctx.addIssue({ code: "custom", path: [key], message: `a ${doc.type} material has no ${key}` });
      }
    }
    for (const slot of Object.keys(doc.maps ?? {})) {
      if (!MATERIAL_SLOTS_OF[doc.type].includes(slot as MaterialSlot)) {
        ctx.addIssue({ code: "custom", path: ["maps", slot], message: `a ${doc.type} material has no ${slot} map` });
      }
    }
  });
export type MaterialDocument = z.infer<typeof materialDocumentSchema>;

/** The fields of every type. The material editor keeps them on a change of the type. */
export const MATERIAL_COMMON_FIELDS: ReadonlySet<string> = new Set([
  "format",
  "name",
  "type",
  "colour",
  "opacity",
  "alphaTest",
  "side",
  "maps",
]);

const LIT = ["flatShading", "emissive", "emissiveIntensity", "normalScale"];
const PBR = [...LIT, "roughness", "metalness"];

/** The fields that each type takes in addition to the common fields. */
export const MATERIAL_FIELDS: Readonly<Record<MaterialType, readonly string[]>> = {
  standard: PBR,
  physical: [
    ...PBR,
    "clearcoat",
    "clearcoatRoughness",
    "sheen",
    "sheenColour",
    "sheenRoughness",
    "transmission",
    "thickness",
    "ior",
    "iridescence",
    "specularIntensity",
    "specularColour",
  ],
  lambert: LIT,
  phong: [...LIT, "specular", "shininess"],
  unlit: [],
};

/** The texture slots that each type takes. */
export const MATERIAL_SLOTS_OF: Readonly<Record<MaterialType, readonly MaterialSlot[]>> = {
  standard: MATERIAL_SLOTS,
  physical: MATERIAL_SLOTS,
  lambert: ["colour", "normal", "emissive", "occlusion", "alpha"],
  phong: ["colour", "normal", "emissive", "occlusion", "alpha"],
  unlit: ["colour", "occlusion", "alpha"],
};

/** The texture asset references of a material document, one time each, in slot order. */
export function materialTextureRefs(doc: MaterialDocument): string[] {
  const refs: string[] = [];
  for (const slot of MATERIAL_SLOTS) {
    const ref = doc.maps?.[slot]?.texture;
    if (ref !== undefined && !refs.includes(ref)) refs.push(ref);
  }
  return refs;
}
