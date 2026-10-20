// SPDX-License-Identifier: Apache-2.0
/**
 * The import settings: the zod schemas of the `settings` object of an asset record. Each setting has a
 * default, so an empty object is valid. A model importer reads `modelImportSettingsSchema`: the generic settings
 * (scale, up axis, origin, decimate, merge) and the recipe settings of the Blender model importer
 * (`blender/import_fbx_prop.py`: materials, bake, parts, sockets and the other keys of the `fbx-prop` recipe).
 * A texture importer reads `textureImportSettingsSchema`, an environment importer `environmentImportSettingsSchema`,
 * and a sound importer `audioImportSettingsSchema`.
 *
 * The places of the recipe (origin points, sockets, part pivots, boxes) are metres in the frame of Blender: Z is up and
 * a model faces -Y. The file paths of the recipe are relative to the folder of the source file.
 */
import { relativePathSchema } from "@scenity/scene";
import { z } from "zod";

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const unit = z.number().min(0).max(1);
const rgb = z.tuple([unit, unit, unit]);
const names = z.array(z.string().min(1));
const box = z.strictObject({ min: vec3, max: vec3 });
const edge = z.number().int().min(1).max(16384);

/** One mesh reduction: a mesh with more than `above` triangles keeps `ratio` of them (or loses `unsubdivide` steps). */
export const decimateSpecSchema = z
  .strictObject({
    above: z.number().int().min(0).default(0),
    ratio: z.number().gt(0).max(1).optional(),
    /** Un-subdivide steps in place of `ratio` (Blender only). */
    unsubdivide: z.number().int().min(1).optional(),
    /** Clear the custom normals and shade smooth after the reduction (Blender only). */
    smooth: z.boolean().optional(),
    /** Only the meshes of these object names (Blender only; default: all meshes). */
    objects: names.optional(),
  })
  .refine((spec) => (spec.ratio === undefined) !== (spec.unsubdivide === undefined), {
    message: "a decimate spec has a ratio or an unsubdivide count, not both",
  });

/** A texture set of the recipe: the files of one material (see `PropImportSpec.materials`). */
const textureSetSchema = z.strictObject({
  color: relativePathSchema,
  recolor: rgb.optional(),
  metalness: unit.optional(),
  normal: relativePathSchema,
  orm: relativePathSchema.optional(),
  rma: relativePathSchema.optional(),
  roughness: relativePathSchema.optional(),
  metallic: relativePathSchema.optional(),
  glossiness: relativePathSchema.optional(),
  clear: z.strictObject({ map: relativePathSchema, opacity: unit.optional(), threshold: unit.optional() }).optional(),
  emissive: relativePathSchema.optional(),
  normalConvention: z.enum(["opengl", "directx"]).optional(),
});

/** The keys of the recipe: a model with one of these keys goes through Blender (`import_fbx_prop.py`). */
export const RECIPE_KEYS = [
  "keep",
  "drop",
  "add",
  "dropParts",
  "splitParts",
  "lift",
  "materials",
  "colors",
  "fills",
  "surfaces",
  "textureSize",
  "bake",
  "sockets",
  "parts",
] as const;

/** The origin of a model: the source origin, the centre of the base, the centre of the bounds, or a point (Blender). */
export const originSchema = z.union([z.enum(["source", "base-centre", "centre"]), vec3]);

export const modelImportSettingsSchema = z.strictObject({
  /**
   * The factor from the units of the file to metres. "auto" reads the unit of the file: metres for glTF, the unit of
   * the file for FBX, the unit scale of a .blend scene, a guess from the size for OBJ.
   */
  scale: z.union([z.literal("auto"), z.number().positive()]).default("auto"),
  /** The up axis of the model after the read. "z" turns the model so that its +Z axis points up. */
  up: z.enum(["y", "z"]).default("y"),
  origin: originSchema.default("source"),
  /** A ratio for each mesh, a spec, or a list of specs for groups of meshes. */
  decimate: z.union([z.number().gt(0).max(1), decimateSpecSchema, z.array(decimateSpecSchema).min(1)]).optional(),
  /** Join the meshes into as few meshes as the materials allow. The recipe always joins (except with `parts`). */
  merge: z.boolean().default(false),
  /** The largest edge of an image in px: the Blender importers scale a larger image down. */
  maxTextureSize: edge.default(2048),
  keep: names.optional(),
  drop: names.optional(),
  add: z
    .array(
      z.strictObject({
        model: relativePathSchema,
        at: vec3.optional(),
        turn: z.number().optional(),
        tilt: z.number().optional(),
        roll: z.number().optional(),
        drop: names.optional(),
      }),
    )
    .optional(),
  dropParts: z.array(box).optional(),
  splitParts: z
    .record(z.string(), z.array(z.strictObject({ ...box.shape, minVertices: z.number().int().min(1).optional() })))
    .optional(),
  lift: z
    .strictObject({ from: z.number(), to: z.number(), by: z.number() })
    .refine((lift) => lift.from < lift.to, { message: "lift.from is below lift.to" })
    .optional(),
  materials: z.record(z.string(), textureSetSchema).optional(),
  colors: z
    .record(z.string(), z.strictObject({ color: z.array(unit).min(3).max(4), roughness: unit.optional() }))
    .optional(),
  fills: z
    .record(z.string(), z.array(z.strictObject({ rect: z.array(unit).length(4), color: z.array(unit).min(3).max(4) })))
    .optional(),
  surfaces: z.record(z.string(), z.strictObject({ roughness: unit.optional(), metallic: unit.optional() })).optional(),
  textureSize: z.partialRecord(z.enum(["color", "normal", "orm", "emissive"]), edge).optional(),
  /** Bake the colors of every material into one texture of `size` px; the materials of `keep` stay apart. */
  bake: z.strictObject({ size: edge, roughness: unit.optional(), keep: names.optional() }).optional(),
  /** Empties for the renderer: {name: {at, size, tilt}}. */
  sockets: z
    .record(
      z.string().min(1),
      z.strictObject({ at: vec3, size: z.tuple([z.number(), z.number()]).optional(), tilt: z.number().optional() }),
    )
    .optional(),
  /** Separate meshes in place of one body: each part joins its objects and has its origin at `pivot`. */
  parts: z
    .record(
      z.string().min(1),
      z.strictObject({ objects: names.min(1), triangles: z.number().int().min(1).optional(), pivot: vec3.optional() }),
    )
    .optional(),
});

export type ModelImportSettings = z.infer<typeof modelImportSettingsSchema>;
export type DecimateSettings = z.infer<typeof decimateSpecSchema>;

/** The role of a texture: the build picks the codec and the colour space by role. */
export const TEXTURE_ROLES = ["color", "normal", "orm", "emissive", "mask", "data"] as const;

export const textureImportSettingsSchema = z.strictObject({
  role: z.enum(TEXTURE_ROLES).default("color"),
  /** The colour space of the pixels: sRGB for colours, linear for data. */
  colorSpace: z.enum(["srgb", "linear"]).default("srgb"),
  /** The largest edge in px: the build scales a larger texture down. */
  maxSize: edge.default(2048),
  mipmaps: z.boolean().default(true),
});

export type TextureImportSettings = z.infer<typeof textureImportSettingsSchema>;

export const environmentImportSettingsSchema = z.strictObject({
  /** The largest edge in px: the build scales a larger map down. */
  maxSize: edge.default(2048),
  /** A factor on the light of the map. */
  intensity: z.number().positive().default(1),
});

export type EnvironmentImportSettings = z.infer<typeof environmentImportSettingsSchema>;

/** The settings of a sound importer: none yet. The import copies the file as it is. */
export const audioImportSettingsSchema = z.strictObject({});

export type AudioImportSettings = z.infer<typeof audioImportSettingsSchema>;

/** The settings of the material importer: none yet. The import checks the document and writes it again. */
export const materialImportSettingsSchema = z.strictObject({});

export type MaterialImportSettings = z.infer<typeof materialImportSettingsSchema>;

/** True when the settings need the recipe of the Blender model importer. */
export function needsRecipe(settings: ModelImportSettings): boolean {
  if (RECIPE_KEYS.some((key) => settings[key] !== undefined)) return true;
  if (Array.isArray(settings.origin)) return true;
  const specs = decimateSpecs(settings);
  return specs.some((spec) => spec.unsubdivide !== undefined || spec.smooth === true || spec.objects !== undefined);
}

/** The decimate specs of the settings, in order (a ratio is one spec for all meshes). */
export function decimateSpecs(settings: ModelImportSettings): DecimateSettings[] {
  const value = settings.decimate;
  if (value === undefined) return [];
  if (typeof value === "number") return [{ above: 0, ratio: value }];
  return Array.isArray(value) ? value : [value];
}
