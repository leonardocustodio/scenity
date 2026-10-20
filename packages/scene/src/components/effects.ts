// SPDX-License-Identifier: Apache-2.0
/**
 * The post-processing fields of the `environment` component: ambient occlusion, bloom, anti-aliasing and the
 * selection outline. Each effect is a value of the scene document. The quality tier caps the effects that draw
 * (effectCaps.ts). An absent field draws no effect, so a scene with no effect field keeps its frames.
 */
import { z } from "zod";
import { colourSchema } from "../schema/common";

/**
 * The ambient occlusion of the scene (GTAO in both backends). `radius` is the radius of the sample in metres.
 * `intensity` is the share of the occlusion that darkens the frame: 0 is no change, 1 is the full occlusion.
 */
export const aoSchema = z.strictObject({
  on: z.boolean().optional(),
  radius: z.number().gt(0).max(10).optional(),
  intensity: z.number().min(0).max(1).optional(),
});
export type AoValue = z.infer<typeof aoSchema>;

/**
 * The bloom of the scene (the Unreal bloom of three.js in both backends). A pixel above the luminance `threshold`
 * glows. `strength` multiplies the glow. `radius` (0 to 1) spreads the glow.
 */
export const bloomSchema = z.strictObject({
  on: z.boolean().optional(),
  threshold: z.number().min(0).optional(),
  strength: z.number().min(0).max(10).optional(),
  radius: z.number().min(0).max(1).optional(),
});
export type BloomValue = z.infer<typeof bloomSchema>;

/**
 * The anti-aliasing of the effect frames. `fxaa` and `smaa` are filters of the final picture. `msaa` takes 4 samples
 * per pixel in the scene pass. With no other effect, the canvas uses its own multisample buffer.
 */
export const ANTIALIAS_MODES = ["none", "fxaa", "smaa", "msaa"] as const;
export type AntialiasMode = (typeof ANTIALIAS_MODES)[number];

/**
 * The outline of the selection of the editor and of the scene page. `thickness` is the width of the edge in pixels.
 * `strength` multiplies the colour of the edge. `on: false` draws no outline for a selection.
 */
export const outlineSchema = z.strictObject({
  on: z.boolean().optional(),
  colour: colourSchema.optional(),
  thickness: z.number().min(0.5).max(8).optional(),
  strength: z.number().gt(0).max(10).optional(),
});
export type OutlineValue = z.infer<typeof outlineSchema>;

/** The post-processing fields of the `environment` component. */
export const effectFields = {
  ao: aoSchema.optional(),
  bloom: bloomSchema.optional(),
  antialias: z.enum(ANTIALIAS_MODES).optional(),
  outline: outlineSchema.optional(),
};

/** The editor hints of the post-processing fields. */
export const effectEditorFields = {
  ao: { widget: { kind: "custom", name: "ambientOcclusion" }, label: "Ambient occlusion", group: "Effects" },
  bloom: { widget: { kind: "custom", name: "bloom" }, label: "Bloom", group: "Effects" },
  antialias: { widget: { kind: "enum", options: ANTIALIAS_MODES }, label: "Anti-aliasing", group: "Effects" },
  outline: { widget: { kind: "custom", name: "selectionOutline" }, label: "Selection outline", group: "Effects" },
} as const;
