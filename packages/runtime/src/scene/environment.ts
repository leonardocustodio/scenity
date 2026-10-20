// SPDX-License-Identifier: Apache-2.0
/**
 * The scene-level values: the background, the fog, the tone mapping, the exposure and
 * the environment map of the `environment` field of the scene. The builder gives them to the host as values. The
 * host applies them to its scene and its renderer. It also makes the PMREM of the map, because that needs the
 * renderer.
 */
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  CineonToneMapping,
  Fog,
  FogExp2,
  LinearToneMapping,
  NeutralToneMapping,
  NoToneMapping,
  ReinhardToneMapping,
  type Color,
  type ToneMapping,
} from "three";
import type { ComponentRegistry, EnvironmentValue, TONE_MAPPINGS } from "@scenity/scene/components";
import type { EffectsValue } from "@scenity/scene/effects";
import { toColor } from "./colour";

export type ToneMappingName = (typeof TONE_MAPPINGS)[number];

const TONE_MAPPING: Readonly<Record<ToneMappingName, ToneMapping>> = {
  none: NoToneMapping,
  linear: LinearToneMapping,
  reinhard: ReinhardToneMapping,
  cineon: CineonToneMapping,
  aces: ACESFilmicToneMapping,
  agx: AgXToneMapping,
  neutral: NeutralToneMapping,
};

/** The scene-level values for the host. */
export interface SceneEnvironment {
  readonly background: Color;
  readonly toneMappingName: ToneMappingName;
  /** The three.js constant of the tone mapping, for `renderer.toneMapping`. */
  readonly toneMapping: ToneMapping;
  /** The value for `renderer.toneMappingExposure`. */
  readonly exposure: number;
  /** The asset reference of the environment map, or null. The host loads it and makes its PMREM. */
  readonly map: string | null;
  readonly mapIntensity: number;
  readonly fog: Fog | FogExp2 | null;
  /** The post-processing values as the document stores them. The host caps them by its tier. */
  readonly effects: EffectsValue;
  /** A count that increases at each change of the values, so the host knows when to apply them again. */
  readonly revision: number;
}

/** The scene-level values of a stored `environment` field, with the defaults of the registry under it. */
export function readEnvironment(
  stored: EnvironmentValue | undefined,
  registry: ComponentRegistry,
  revision: number,
): SceneEnvironment {
  const value = registry.fill("environment", stored ?? {}) as EnvironmentValue;
  const toneMappingName = value.toneMapping ?? "aces";
  let fog: Fog | FogExp2 | null = null;
  if (value.fog?.type === "linear") fog = new Fog(toColor(value.fog.colour), value.fog.near, value.fog.far);
  if (value.fog?.type === "exp2") fog = new FogExp2(toColor(value.fog.colour).getHex(), value.fog.density);
  return {
    background: toColor(value.background ?? "#000000"),
    toneMappingName,
    toneMapping: TONE_MAPPING[toneMappingName],
    exposure: value.exposure ?? 1,
    map: value.map ?? null,
    mapIntensity: value.mapIntensity ?? 1,
    fog,
    effects: value,
    revision,
  };
}
