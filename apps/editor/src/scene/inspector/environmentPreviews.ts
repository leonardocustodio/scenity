// SPDX-License-Identifier: Apache-2.0
/**
 * The previews of the environment hints of the inspector: the fog over the distance, the
 * bloom of a row of bright samples, the ambient occlusion in a corner, and the selection outline of a box. Each
 * preview is a function of the value of its field, so it changes with each edit and with each step of a number drag.
 * The previews show what the values do: they are not a render of the scene. An absent field takes the
 * defaults of the effects of the frames (`frameEffects` of `@scenity/scene`). Pure functions, no DOM.
 */
import { colourHex } from "@scenity/editor-core";
import { EFFECT_DEFAULTS } from "@scenity/scene/effects";

/** The custom widget names of the environment hints that have a preview. */
export const PREVIEW_WIDGETS = ["fog", "bloom", "ambientOcclusion", "selectionOutline"] as const;
export type PreviewWidget = (typeof PREVIEW_WIDGETS)[number];

/** True for the name of a custom widget with a preview. */
export function hasPreview(name: string | undefined): name is PreviewWidget {
  return (PREVIEW_WIDGETS as readonly (string | undefined)[]).includes(name);
}

const record = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const number = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const round = (value: number): number => Math.round(value * 1000) / 1000;

/** The fog over the distance: the share of the fog colour at each stop, and the distance of the last stop. */
export interface FogPreview {
  readonly on: boolean;
  readonly colour: string;
  /** The distance of the right edge of the strip (metres). */
  readonly distance: number;
  /** The share of the fog colour (0 to 1) at even steps from 0 to `distance`. */
  readonly stops: readonly number[];
}

/** The fog factor of a value at a distance: linear between near and far, or 1 - e^-(density·d)². */
function fogAt(value: Readonly<Record<string, unknown>>, distance: number): number {
  if (value.type === "linear") {
    const near = number(value.near, 0);
    const far = Math.max(near + 1e-6, number(value.far, 1));
    return Math.min(1, Math.max(0, (distance - near) / (far - near)));
  }
  const density = number(value.density, 0);
  return 1 - Math.exp(-((density * distance) ** 2));
}

/** The preview of a fog value; no fog gives a strip with no fog. */
export function fogPreview(value: unknown, steps = 8): FogPreview {
  const fog = record(value);
  const on = fog.type === "linear" || fog.type === "exp2";
  const colour = colourHex(fog.colour);
  // The strip shows the distance where the fog is full: the far plane, or a fog factor of 0.99 for exp2.
  const density = number(fog.density, 0);
  const distance = !on
    ? 10
    : fog.type === "linear"
      ? number(fog.far, 10) * 1.2
      : density > 0
        ? Math.sqrt(-Math.log(0.01)) / density
        : 10;
  const stops = Array.from({ length: steps + 1 }, (_, at) => (on ? round(fogAt(fog, (distance * at) / steps)) : 0));
  return { on, colour, distance: round(distance), stops };
}

/** The bloom of a row of samples: their brightness, and the glow of each one (0: no glow). */
export interface BloomPreview {
  readonly on: boolean;
  readonly samples: readonly { readonly brightness: number; readonly glow: number }[];
  /** The spread of the glow (0 to 1). */
  readonly spread: number;
}

/** The brightness of the samples of the bloom preview (the luminance of a pixel; 1 is white). */
export const BLOOM_SAMPLES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** The preview of a bloom value: a sample above the threshold glows by the strength. */
export function bloomPreview(value: unknown): BloomPreview {
  const bloom = record(value);
  const on = value !== undefined && bloom.on !== false;
  const threshold = number(bloom.threshold, EFFECT_DEFAULTS.bloom.threshold);
  const strength = number(bloom.strength, EFFECT_DEFAULTS.bloom.strength);
  const samples = BLOOM_SAMPLES.map((brightness) => ({
    brightness,
    glow: on && brightness > threshold ? round(Math.min(1, (brightness - threshold) * strength)) : 0,
  }));
  return { on, samples, spread: round(number(bloom.radius, EFFECT_DEFAULTS.bloom.radius)) };
}

/** The ambient occlusion of a corner: the darkness at the corner and the width of the shade. */
export interface AoPreview {
  readonly on: boolean;
  /** The darkness in the corner (0 to 1). */
  readonly darkness: number;
  /** The width of the shade as a share of the half of the preview (0 to 1). */
  readonly width: number;
}

/** The preview of an ambient occlusion value. The width grows with the radius and stops at 2 m. */
export function aoPreview(value: unknown): AoPreview {
  const ao = record(value);
  const on = value !== undefined && ao.on !== false;
  const radius = number(ao.radius, EFFECT_DEFAULTS.ao.radius);
  const darkness = on ? round(number(ao.intensity, EFFECT_DEFAULTS.ao.intensity)) : 0;
  return { on, darkness, width: round(Math.min(1, radius / 2)) };
}

/** The selection outline of a box: its colour, its width in pixels and its strength. */
export interface OutlinePreview {
  readonly on: boolean;
  readonly colour: string;
  readonly thickness: number;
  /** The strength as an opacity (0 to 1). */
  readonly opacity: number;
}

/** The preview of a selection outline value (the defaults of the effect when a field is absent). */
export function outlinePreview(value: unknown): OutlinePreview {
  const outline = record(value);
  return {
    on: outline.on !== false,
    colour: colourHex(outline.colour ?? EFFECT_DEFAULTS.outline.colour),
    thickness: round(number(outline.thickness, EFFECT_DEFAULTS.outline.thickness)),
    opacity: round(Math.min(1, number(outline.strength, EFFECT_DEFAULTS.outline.strength) / 3)),
  };
}
