// SPDX-License-Identifier: Apache-2.0
/**
 * The values of a light: the `light` component into a three.js light, and the limits of a quality
 * tier over the lights of a scene. The light presenter (presenters/light.ts) and a plugin core with its own lights
 * (`@scenity/runtime/lights`) use the same code, so a document gives the same light on both paths.
 *
 * The module tests the light kind with the `is…Light` flags of three.js, not with `instanceof`. Thus a core that
 * imports it does not get the classes of the light kinds that it does not make.
 *
 * - `applyLight` writes the colour, the intensity, the range, the cone and the shadow values. It keeps the shadow
 *   request of the component in `userData.shadow` and the shadow camera of the document in `userData.shadowCamera`.
 * - `applyLightTier` decides which lights show and which lights cast a shadow, and sets the shadow map size.
 */
import type {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  OrthographicCamera,
  PerspectiveCamera,
  PointLight,
  SpotLight,
} from "three";
import type { LightValue, ShadowCameraValue } from "@scenity/scene/components";
import type { Tiering } from "../core/tiers";
import { setColour } from "./colour";

/** A light of one of the five kinds of the `light` component. */
export type AnyLight = DirectionalLight | PointLight | SpotLight | AmbientLight | HemisphereLight;

/** A light that can cast a shadow. */
export type ShadowLight = DirectionalLight | PointLight | SpotLight;

const SHADOW_BIAS = -0.0005;
const SHADOW_NORMAL_BIAS = 0.02;
const DEFAULT_ANGLE = 0.785398;

/** True for a directional, point or spot light. */
export function isShadowLight(light: AnyLight): light is ShadowLight {
  return "isDirectionalLight" in light || "isPointLight" in light || "isSpotLight" in light;
}

/** The shadow request of the component: the tier decides if the light casts it. */
export function wantsShadow(light: AnyLight): boolean {
  return light.userData.shadow === true;
}

/** The shadow camera values of the document, or an empty object. */
export function givenShadowCamera(light: AnyLight): ShadowCameraValue {
  return (light.userData.shadowCamera as ShadowCameraValue | undefined) ?? {};
}

/**
 * Write the given values of the shadow camera. A spot or point light uses only near and far: three.js does not read
 * the box values of a perspective camera. The runtime fits the other values (scene/shadowFit.ts).
 */
function setShadowCamera(camera: OrthographicCamera | PerspectiveCamera, given: ShadowCameraValue): void {
  Object.assign(camera, given);
  camera.updateProjectionMatrix();
}

function applyShadow(light: AnyLight, value: LightValue): void {
  light.userData.shadow = value.shadow === true;
  light.userData.shadowCamera = value.shadowCamera;
  light.castShadow = value.shadow === true;
  if (!isShadowLight(light)) return;
  light.shadow.bias = value.shadowBias ?? SHADOW_BIAS;
  light.shadow.normalBias = value.shadowNormalBias ?? SHADOW_NORMAL_BIAS;
  if (value.shadowCamera !== undefined) setShadowCamera(light.shadow.camera, value.shadowCamera);
}

/** Write the values of the component into the light. This function changes neither the light kind nor the place. */
export function applyLight(light: AnyLight, value: LightValue): void {
  setColour(light.color, value.colour ?? "#ffffff");
  light.intensity = value.intensity ?? 1;
  if ("isHemisphereLight" in light && value.groundColour !== undefined)
    setColour(light.groundColor, value.groundColour);
  if ("isPointLight" in light || "isSpotLight" in light) {
    light.distance = value.range ?? 0;
    light.decay = 2;
  }
  if ("isSpotLight" in light) {
    light.angle = value.angle ?? DEFAULT_ANGLE;
    light.penumbra = value.penumbra ?? 0;
  }
  applyShadow(light, value);
}

/** The shadow map size of a light for a tier: a spot light gets half of it, a point light (six faces) a quarter. */
function shadowMapSize(light: ShadowLight, tierSize: number): number {
  if ("isSpotLight" in light) return tierSize / 2;
  return "isPointLight" in light ? tierSize / 4 : tierSize;
}

/**
 * Apply the light limits of a tier to the lights of a scene, in their order: the first `tiering.lights` directional,
 * point and spot lights show, and the first `tiering.shadowLights` of them with a shadow request cast it. Ambient and
 * hemisphere lights always show. A new shadow map size removes the shadow map, so the renderer makes a new one.
 */
export function applyLightTier(lights: readonly AnyLight[], tiering: Tiering): void {
  let shown = 0;
  let shadows = 0;
  for (const light of lights) {
    if (!isShadowLight(light)) continue;
    light.visible = shown < tiering.lights;
    shown += 1;
    const cast = light.visible && wantsShadow(light) && shadows < tiering.shadowLights;
    light.castShadow = cast;
    if (cast) shadows += 1;
    const size = shadowMapSize(light, tiering.shadowMap);
    if (light.shadow.mapSize.width === size) continue;
    light.shadow.mapSize.set(size, size);
    light.shadow.map?.dispose();
    light.shadow.map = null;
  }
}
