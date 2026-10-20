// SPDX-License-Identifier: Apache-2.0
/**
 * The lights of a frame. The host of the scene builder calls `frameLighting` before it draws. One walk of the
 * graph finds the lights in their order, the world box of the scene and the world box of the shadow casters. Then
 * the limits of the tier apply (scene/lights.ts), and the shadow camera of each light that casts a shadow fits the
 * shadow casters (scene/shadowFit.ts). The result is a function of the graph and the tier, so the worker and the main
 * thread give the same frame.
 *
 * A hidden object and its children do not count. A light that the tier hid still counts, so it can show again.
 */
import { Box3, type InstancedMesh, type Mesh, type Object3D } from "three";
import type { Tiering } from "../core/tiers";
import { applyLightTier, isShadowLight, type AnyLight } from "./lights";
import { fitShadowCamera } from "./shadowFit";

/** The lights and the boxes of one walk of the graph. */
export interface FrameLighting {
  readonly lights: readonly AnyLight[];
  /** The world box of each visible mesh. */
  readonly scene: Box3;
  /** The world box of each visible mesh that casts a shadow. */
  readonly casters: Box3;
}

const box = new Box3();

function isLight(object: Object3D): object is AnyLight {
  return "isLight" in object;
}

function isMesh(object: Object3D): object is Mesh {
  return "isMesh" in object;
}

/** The box of a mesh in its own frame: the box of its instances, else the box of its geometry. */
function localBox(mesh: Mesh): Box3 | null {
  if ("isInstancedMesh" in mesh) {
    const instanced = mesh as InstancedMesh;
    if (instanced.boundingBox === null) instanced.computeBoundingBox();
    return instanced.boundingBox;
  }
  if (mesh.geometry.boundingBox === null) mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox;
}

/** Add the world box of a mesh to the boxes. A skinned mesh counts with its box in the bind pose. */
function addMesh(mesh: Mesh, out: FrameLighting): void {
  const local = localBox(mesh);
  if (local === null || local.isEmpty()) return;
  box.copy(local).applyMatrix4(mesh.matrixWorld);
  out.scene.union(box);
  if (mesh.castShadow) out.casters.union(box);
}

function walk(object: Object3D, out: FrameLighting & { lights: AnyLight[] }): void {
  if (isLight(object)) out.lights.push(object);
  else if (!object.visible) return;
  else if (isMesh(object)) addMesh(object, out);
  for (const child of object.children) walk(child, out);
}

/** The lights and the boxes of a graph. The world matrices must be current. */
export function readLighting(root: Object3D): FrameLighting {
  const out = { lights: [] as AnyLight[], scene: new Box3(), casters: new Box3() };
  walk(root, out);
  return out;
}

/** Apply the tier to the lights of the graph and fit each shadow camera. The result has the boxes of the frame. */
export function frameLighting(root: Object3D, tiering: Tiering): FrameLighting {
  root.updateMatrixWorld();
  const lighting = readLighting(root);
  applyLightTier(lighting.lights, tiering);
  if (lighting.casters.isEmpty()) return lighting;
  for (const light of lighting.lights) {
    if (isShadowLight(light) && light.castShadow) fitShadowCamera(light, lighting.casters, lighting.scene);
  }
  return lighting;
}
