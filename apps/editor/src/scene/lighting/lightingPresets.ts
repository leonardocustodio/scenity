// SPDX-License-Identifier: Apache-2.0
/**
 * The lighting presets of the Lighting window: a set of the values of the `environment`
 * component (the background, the tone mapping, the exposure, the intensity of the environment map, the fog and the
 * effects). A preset keeps the environment map, the anti-aliasing and the selection outline of the scene, and it takes
 * the place of the other values (a preset with no fog takes the fog away). Pure functions, no DOM.
 */
import type { EnvironmentValue } from "@scenity/scene/components";

/** A preset: its ID (its label is the Fluent message `lighting-preset-<id>`) and its values. */
export interface LightingPreset {
  readonly id: string;
  readonly values: Readonly<EnvironmentValue>;
}

export const LIGHTING_PRESETS: readonly LightingPreset[] = [
  {
    id: "studio",
    values: { background: "#1a2433", toneMapping: "aces", exposure: 1, mapIntensity: 1, ao: { radius: 0.25 } },
  },
  {
    id: "daylight",
    values: {
      background: "#bcd4e6",
      toneMapping: "aces",
      exposure: 1.2,
      mapIntensity: 1.2,
      fog: { type: "exp2", colour: "#c8d8e8", density: 0.02 },
      ao: { radius: 0.3 },
    },
  },
  {
    id: "evening",
    values: {
      background: "#2b1d2e",
      toneMapping: "agx",
      exposure: 0.8,
      mapIntensity: 0.6,
      fog: { type: "linear", colour: "#3a2a3a", near: 8, far: 40 },
      bloom: { threshold: 0.8, strength: 0.6 },
    },
  },
  {
    id: "night",
    values: {
      background: "#05070d",
      toneMapping: "aces",
      exposure: 0.6,
      mapIntensity: 0.2,
      fog: { type: "exp2", colour: "#0a0e18", density: 0.05 },
      bloom: { threshold: 0.7, strength: 0.9 },
    },
  },
  { id: "neutral", values: { background: "#808080", toneMapping: "neutral", exposure: 1, mapIntensity: 1 } },
];

/** The fields that a preset keeps from the scene. */
const KEPT = ["map", "antialias", "outline"] as const;

/** The environment value of a preset over the current value of the scene. */
export function withPreset(current: Readonly<EnvironmentValue> | undefined, preset: LightingPreset): EnvironmentValue {
  const kept = Object.fromEntries(
    KEPT.filter((key) => current?.[key] !== undefined).map((key) => [key, current?.[key]]),
  ) as Partial<EnvironmentValue>;
  return { ...kept, ...preset.values };
}

/** The preset that the current value of the scene matches (each value of the preset is the same), or null. */
export function activePreset(current: Readonly<EnvironmentValue> | undefined): string | null {
  const own = Object.keys(current ?? {}).filter((key) => !(KEPT as readonly string[]).includes(key));
  const found = LIGHTING_PRESETS.find(
    (preset) =>
      own.every((key) => Object.hasOwn(preset.values, key)) &&
      Object.entries(preset.values).every(
        ([key, value]) => JSON.stringify(current?.[key as keyof EnvironmentValue]) === JSON.stringify(value),
      ),
  );
  return found?.id ?? null;
}
