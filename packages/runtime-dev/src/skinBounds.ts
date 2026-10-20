// SPDX-License-Identifier: Apache-2.0
/**
 * A cheap bound of a skinned mesh in its current pose. The ray test of a skinned mesh skins each vertex (about 25 ms
 * for a large character on the main thread, 125 ms in the worker), so the pick first tests the ray against this bound
 * and skips a mesh that the ray misses.
 *
 * The bound is safe for linear blend skinning with rigid bones. A vertex with weights on some bones goes to the
 * weighted mean of the places that each of those bones gives it. Each place is in a sphere around its bone: the radius
 * is the largest distance of a vertex of that bone from the bone in the bind pose, plus the largest move of the morph
 * targets of the vertex. A mean of points in a box is in the box, so the box of the spheres holds the skinned mesh. A
 * bone with a scale or a shear stretches its sphere by at most the stretch of its matrix (stretchOf). A morph influence
 * above 1 does not fit these terms: the bound is then unknown (null), and the pick tests the mesh.
 */
import { Box3, Matrix4, Vector3, type SkinnedMesh } from "three";

/** The radius of each bone (metres in the space of the bone), from the bind pose; calculated one time for each mesh. */
const REACH = new WeakMap<SkinnedMesh, Float32Array>();

/** The sum of the moves of the morph targets of each vertex (influences of at most 1). */
function morphSlack(mesh: SkinnedMesh, count: number): Float32Array {
  const slack = new Float32Array(count);
  const targets = mesh.geometry.morphAttributes.position ?? [];
  const position = mesh.geometry.getAttribute("position");
  const relative = mesh.geometry.morphTargetsRelative;
  const delta = new Vector3();
  const base = new Vector3();
  for (const target of targets) {
    for (let i = 0; i < count; i += 1) {
      delta.fromBufferAttribute(target, i);
      if (!relative) delta.sub(base.fromBufferAttribute(position, i));
      slack[i] = (slack[i] ?? 0) + delta.length();
    }
  }
  return slack;
}

/** The radius of each bone of a skinned mesh: the largest distance of its vertices from it in the bind pose. */
function boneReach(mesh: SkinnedMesh): Float32Array {
  const known = REACH.get(mesh);
  if (known !== undefined) return known;
  const { boneInverses } = mesh.skeleton;
  const reach = new Float32Array(boneInverses.length);
  const position = mesh.geometry.getAttribute("position");
  const index = mesh.geometry.getAttribute("skinIndex");
  const weight = mesh.geometry.getAttribute("skinWeight");
  const slack = morphSlack(mesh, position.count);
  const vertex = new Vector3();
  const local = new Vector3();
  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix);
    for (let k = 0; k < 4; k += 1) {
      if (weight.getComponent(i, k) <= 0) continue;
      const bone = index.getComponent(i, k);
      const inverse = boneInverses[bone];
      if (inverse === undefined) continue;
      const distance = local.copy(vertex).applyMatrix4(inverse).length() + (slack[i] ?? 0);
      if (distance > (reach[bone] ?? 0)) reach[bone] = distance;
    }
  }
  REACH.set(mesh, reach);
  return reach;
}

/**
 * A bound of the stretch of the 3×3 part of a matrix (the most that it makes a vector longer): the longest column when
 * the columns are at right angles (a turn and a scale), else the Frobenius norm (a shear).
 */
export function stretchOf(matrix: Matrix4): number {
  const e = matrix.elements;
  const column = (at: number): [number, number, number] => [e[at] ?? 0, e[at + 1] ?? 0, e[at + 2] ?? 0];
  const [a, b, c] = [column(0), column(4), column(8)];
  type V = readonly [number, number, number];
  const dot = (u: V, v: V): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const lengths = [a, b, c].map((v) => Math.sqrt(dot(v, v)));
  const longest = Math.max(...lengths);
  const square = longest * longest;
  if ([dot(a, b), dot(a, c), dot(b, c)].every((value) => Math.abs(value) <= 1e-6 * square)) return longest;
  return Math.sqrt(lengths.reduce((total, length) => total + length * length, 0));
}

/**
 * The box in the room that holds the skinned mesh in its current pose, or null when the terms of the bound do not hold
 * (a morph influence above 1, a mesh without the skin attributes).
 */
export function skinnedBox(mesh: SkinnedMesh): Box3 | null {
  const geometry = mesh.geometry;
  if (!geometry.hasAttribute("skinIndex") || !geometry.hasAttribute("skinWeight")) return null;
  if ((mesh.morphTargetInfluences ?? []).some((value) => Math.abs(value) > 1)) return null;
  const reach = boneReach(mesh);
  // The room from the space of the bind: the world matrix with the inverse of the bind (the identity when attached).
  const toRoom = new Matrix4().multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse);
  const box = new Box3();
  const bone = new Matrix4();
  const center = new Vector3();
  const size = new Vector3();
  for (const [i, item] of mesh.skeleton.bones.entries()) {
    const radius = reach[i] ?? 0;
    if (radius <= 0) continue;
    item.updateWorldMatrix(true, false);
    bone.multiplyMatrices(toRoom, item.matrixWorld);
    center.setFromMatrixPosition(bone);
    size.setScalar(radius * stretchOf(bone));
    box.expandByPoint(center.clone().sub(size)).expandByPoint(center.add(size));
  }
  return box;
}
