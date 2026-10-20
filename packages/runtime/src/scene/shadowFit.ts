// SPDX-License-Identifier: Apache-2.0
/**
 * The shadow camera from the scene bounds. A shadow camera value that the document gives stays (the `shadowCamera` of
 * the `light` component). The runtime fits each other value:
 *
 * - a directional light: the box of the shadow casters seen from the light gives left, right, top and bottom, and the
 *   nearest caster gives near. Far reaches the farthest point of the scene, so each receiver behind a caster is in the
 *   depth range (a point past far gets no shadow).
 * - a spot or point light: near is a part of the distance to the nearest caster, and far is the distance to the
 *   farthest point of the scene. The range of a spot light, when it has one, sets far (three.js).
 *
 * The values have a margin, so a caster at the edge of the box keeps its whole shadow.
 */
import { Box3, Matrix4, Vector3, type DirectionalLight, type OrthographicCamera, type PerspectiveCamera } from "three";
import { givenShadowCamera, type ShadowLight } from "./lights";

/** The margin of a fitted box: a share of the size of the box and a fixed part in metres. */
const MARGIN_SHARE = 0.02;
const MARGIN_MIN = 0.05;
/** The nearest near plane of a spot or point light in metres, and its share of the distance to the nearest caster. */
const NEAR_MIN = 0.05;
const NEAR_SHARE = 0.9;

const local = new Box3();
const reach = new Box3();
const view = new Matrix4();
const at = new Vector3();
const toward = new Vector3();
const size = new Vector3();

/** Set the values of a camera that differ, then its projection when a value changed. */
function setPlanes(camera: OrthographicCamera | PerspectiveCamera, values: Readonly<Record<string, number>>): void {
  const target = camera as unknown as Record<string, number>;
  let changed = false;
  for (const [key, value] of Object.entries(values)) {
    if (target[key] === value) continue;
    target[key] = value;
    changed = true;
  }
  if (changed) camera.updateProjectionMatrix();
}

/**
 * The shadow camera of a directional light: the casters seen from the light, as LightShadow.updateMatrices sees them.
 */
function fitDirectional(light: DirectionalLight, casters: Box3, scene: Box3): void {
  const given = givenShadowCamera(light);
  const camera = light.shadow.camera;
  camera.position.setFromMatrixPosition(light.matrixWorld);
  toward.setFromMatrixPosition(light.target.matrixWorld);
  camera.lookAt(toward);
  camera.updateMatrixWorld();
  view.copy(camera.matrixWorld).invert();
  local.copy(casters).applyMatrix4(view);
  reach.copy(scene).applyMatrix4(view);
  const margin = Math.max(MARGIN_MIN, MARGIN_SHARE * local.getSize(size).length());
  // The camera looks along its -Z: the depth of a point is -z.
  setPlanes(camera, {
    left: given.left ?? local.min.x - margin,
    right: given.right ?? local.max.x + margin,
    bottom: given.bottom ?? local.min.y - margin,
    top: given.top ?? local.max.y + margin,
    near: given.near ?? -local.max.z - margin,
    far: given.far ?? Math.max(-reach.min.z, -local.min.z) + margin,
  });
}

/** The farthest distance from a point to the corners of a box. */
function farthest(point: Vector3, of: Box3): number {
  let most = 0;
  for (let corner = 0; corner < 8; corner += 1) {
    toward.set(corner & 1 ? of.max.x : of.min.x, corner & 2 ? of.max.y : of.min.y, corner & 4 ? of.max.z : of.min.z);
    most = Math.max(most, toward.distanceTo(point));
  }
  return most;
}

/** The depth range of a spot or point light: from the nearest caster to the farthest point of the scene. */
function fitRange(light: ShadowLight, casters: Box3, scene: Box3): void {
  const given = givenShadowCamera(light);
  at.setFromMatrixPosition(light.matrixWorld);
  const far = given.far ?? farthest(at, scene) * (1 + MARGIN_SHARE) + MARGIN_MIN;
  const near = given.near ?? Math.min(far / 2, Math.max(NEAR_MIN, casters.distanceToPoint(at) * NEAR_SHARE));
  setPlanes(light.shadow.camera, { near, far });
}

/**
 * Fit the shadow camera of a light that casts a shadow to the boxes of the frame. The world matrices must be current.
 */
export function fitShadowCamera(light: ShadowLight, casters: Box3, scene: Box3): void {
  if ("isDirectionalLight" in light) fitDirectional(light, casters, scene);
  else fitRange(light, casters, scene);
}
