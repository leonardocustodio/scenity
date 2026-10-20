// SPDX-License-Identifier: Apache-2.0
/**
 * The quality tiers of a scene core: the pixel ratio cap, the shadow map, the frame cap and the light limits of each
 * tier.
 */
import type { Tier } from "../protocol";

/** The values of one quality tier. */
export interface Tiering {
  readonly dprCap: number;
  readonly shadows: boolean;
  /** The size of the shadow map of a directional light in texels. A spot light gets half, a point light a quarter. */
  readonly shadowMap: number;
  /** The frame cap (frames per second). Infinity gives no cap: the core draws at each frame of the scheduler. */
  readonly fps: number;
  /** The number of directional, point and spot lights that show. Ambient and hemisphere lights always show. */
  readonly lights: number;
  /** The number of lights that cast a shadow. Zero when `shadows` is false. */
  readonly shadowLights: number;
}

export const TIERS: Readonly<Record<Tier, Tiering>> = {
  ultra: { dprCap: 2, shadows: true, shadowMap: 2048, fps: Number.POSITIVE_INFINITY, lights: 16, shadowLights: 4 },
  high: { dprCap: 2, shadows: true, shadowMap: 2048, fps: 60, lights: 8, shadowLights: 2 },
  medium: { dprCap: 1.5, shadows: true, shadowMap: 1024, fps: 30, lights: 4, shadowLights: 1 },
  low: { dprCap: 1, shadows: false, shadowMap: 512, fps: 30, lights: 2, shadowLights: 0 },
};
