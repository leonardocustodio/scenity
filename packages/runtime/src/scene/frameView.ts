// SPDX-License-Identifier: Apache-2.0
/**
 * The view numbers of a frame: the spheres of the models and the shapes, and the count of the entities that
 * the camera can see. The levels of detail (scene/lod.ts) use the same spheres for the screen size of a model.
 */
import { Box3, Frustum, Matrix4, Sphere, type Mesh, type Object3D, type PerspectiveCamera } from "three";
import type { EntityNode } from "./graph";
import { modelTemplate } from "./presenters/model";

const spheres = new WeakMap<Object3D, Sphere>();
const box = new Box3();
const frustum = new Frustum();
const viewProjection = new Matrix4();
const world = new Sphere();

/**
 * The sphere of a model template in the frame of the model holder. The value stays in a cache: a template does not
 * change after its load.
 */
export function localSphere(template: Object3D): Sphere {
  let sphere = spheres.get(template);
  if (sphere === undefined) {
    template.updateMatrixWorld(true);
    sphere = box.setFromObject(template).getBoundingSphere(new Sphere());
    spheres.set(template, sphere);
  }
  return sphere;
}

/** True when the object and each of its parents show. */
function shown(object: Object3D): boolean {
  for (let node: Object3D | null = object; node !== null; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

/** The world sphere of the model or the shape of a node, or null when the node has neither or has no load yet. */
export function nodeSphere(node: EntityNode, out: Sphere): Sphere | null {
  const holder = node.parts.get("model")?.object ?? null;
  const template = holder === null ? undefined : modelTemplate(holder);
  if (holder !== null && template !== undefined) {
    return out.copy(localSphere(template)).applyMatrix4(holder.matrixWorld);
  }
  const shape = node.parts.get("shape")?.object ?? null;
  const geometry = shape === null ? undefined : (shape as Partial<Mesh>).geometry;
  if (shape === null || geometry === undefined) return null;
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  return geometry.boundingSphere === null ? null : out.copy(geometry.boundingSphere).applyMatrix4(shape.matrixWorld);
}

/**
 * The number of shown entities with a model or a shape whose sphere meets the view of the camera. The world matrices
 * and the projection of the camera must be current.
 */
export function countVisible(nodes: Iterable<EntityNode>, camera: PerspectiveCamera): number {
  viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(viewProjection);
  let count = 0;
  for (const node of nodes) {
    if (nodeSphere(node, world) === null || !shown(node.group)) continue;
    if (frustum.intersectsSphere(world)) count += 1;
  }
  return count;
}
