// SPDX-License-Identifier: Apache-2.0
/**
 * The tier caps of the post-processing effects and the effects that a frame draws. This file has only data and
 * functions with no zod. Thus a runtime core can import them without the schemas.
 *
 * The caps (low to ultra):
 *
 * | Tier   | Ambient occlusion | Bloom | Anti-aliasing             | Selection outline |
 * | ------ | ----------------- | ----- | ------------------------- | ----------------- |
 * | low    | no                | no    | none                      | yes               |
 * | medium | no                | no    | none, fxaa                | yes               |
 * | high   | no                | yes   | none, fxaa                | yes               |
 * | ultra  | yes               | yes   | none, fxaa, smaa, msaa    | yes               |
 *
 * An anti-aliasing mode above the cap falls to the best mode of the tier (smaa or msaa on the high tier gives fxaa).
 * The selection outline is a tool of the editor, not a look of the scene: it draws on each tier.
 */
import type { AntialiasMode, AoValue, BloomValue, OutlineValue } from "./components/effects";
import type { Colour } from "./schema/common";

/** The quality tiers of the runtime (`Tier` of `@scenity/runtime/protocol`). */
export type EffectTier = "low" | "medium" | "high" | "ultra";

/** The effects that a tier lets a frame draw. */
export interface EffectCap {
  readonly ao: boolean;
  readonly bloom: boolean;
  /** The anti-aliasing modes of the tier, from the lowest cost to the highest. */
  readonly antialias: readonly AntialiasMode[];
  readonly outline: boolean;
}

export const EFFECT_CAPS: Readonly<Record<EffectTier, EffectCap>> = {
  low: { ao: false, bloom: false, antialias: ["none"], outline: true },
  medium: { ao: false, bloom: false, antialias: ["none", "fxaa"], outline: true },
  high: { ao: false, bloom: true, antialias: ["none", "fxaa"], outline: true },
  ultra: { ao: true, bloom: true, antialias: ["none", "fxaa", "smaa", "msaa"], outline: true },
};

/** The defaults of each effect value. An effect object with no `on` field is on. */
export const EFFECT_DEFAULTS = {
  ao: { radius: 0.25, intensity: 1 },
  bloom: { threshold: 0.85, strength: 0.6, radius: 0.4 },
  outline: { colour: "#ffb020" as Colour, thickness: 1, strength: 3 },
} as const;

/** The post-processing fields of an `environment` value. */
export interface EffectsValue {
  readonly ao?: AoValue | undefined;
  readonly bloom?: BloomValue | undefined;
  readonly antialias?: AntialiasMode | undefined;
  readonly outline?: OutlineValue | undefined;
}

/** The effects of a frame after the tier cap, with each default filled in. Null is an effect that does not draw. */
export interface FrameEffects {
  readonly ao: { readonly radius: number; readonly intensity: number } | null;
  readonly bloom: { readonly threshold: number; readonly strength: number; readonly radius: number } | null;
  readonly antialias: AntialiasMode;
  /** The outline of a selection. It draws only when the frame has a selection. */
  readonly outline: { readonly colour: Colour; readonly thickness: number; readonly strength: number } | null;
}

/** The anti-aliasing mode of a request under the cap of a tier: the request, else the best mode of the tier. */
function cappedAntialias(mode: AntialiasMode, cap: EffectCap): AntialiasMode {
  if (cap.antialias.includes(mode)) return mode;
  return cap.antialias[cap.antialias.length - 1] ?? "none";
}

/** The effects of a frame from the stored values and the tier. */
export function frameEffects(value: EffectsValue | undefined, tier: EffectTier): FrameEffects {
  const cap = EFFECT_CAPS[tier];
  const ao = value?.ao;
  const bloom = value?.bloom;
  const outline = value?.outline;
  return {
    ao:
      ao !== undefined && ao.on !== false && cap.ao
        ? {
            radius: ao.radius ?? EFFECT_DEFAULTS.ao.radius,
            intensity: ao.intensity ?? EFFECT_DEFAULTS.ao.intensity,
          }
        : null,
    bloom:
      bloom !== undefined && bloom.on !== false && cap.bloom
        ? {
            threshold: bloom.threshold ?? EFFECT_DEFAULTS.bloom.threshold,
            strength: bloom.strength ?? EFFECT_DEFAULTS.bloom.strength,
            radius: bloom.radius ?? EFFECT_DEFAULTS.bloom.radius,
          }
        : null,
    antialias: cappedAntialias(value?.antialias ?? "none", cap),
    // An absent outline field gives the default outline: the selection always shows, unless `on` is false.
    outline:
      outline?.on !== false && cap.outline
        ? {
            colour: outline?.colour ?? EFFECT_DEFAULTS.outline.colour,
            thickness: outline?.thickness ?? EFFECT_DEFAULTS.outline.thickness,
            strength: outline?.strength ?? EFFECT_DEFAULTS.outline.strength,
          }
        : null,
  };
}

/**
 * The names of the effects that draw in a frame, in the order of the passes: "ao", "bloom", "outline" (with a
 * selection), then the anti-aliasing mode. An empty list draws the frame with no post-processing.
 */
export function activeEffects(effects: FrameEffects, selection: boolean): string[] {
  const names: string[] = [];
  if (effects.ao !== null) names.push("ao");
  if (effects.bloom !== null) names.push("bloom");
  if (effects.outline !== null && selection) names.push("outline");
  if (effects.antialias !== "none") names.push(effects.antialias);
  return names;
}
