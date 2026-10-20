// SPDX-License-Identifier: Apache-2.0
/**
 * A plain mesh of a skinned mesh in its current pose, for the ray test of the pick. The ray test of three.js skins the
 * three corners of each triangle and each vertex again for the bounds, so one vertex gets five or more skinnings. This
 * module skins each vertex one time (`getVertexPosition`: the morph targets, then the bones) into the positions of a
 * plain mesh with the same index, groups, material and world matrix. The ray test of that mesh then gives the hits of
 * the skinned mesh: the same triangles at the same places.
 *
 * The plain mesh is not in the scene and draws nothing. Its geometry stays with the skinned mesh (a WeakMap) and gets
 * new positions at each pick, so a pick never reads a pose of an earlier frame.
 */
import { BufferAttribute, BufferGeometry, Mesh, Vector3, type SkinnedMesh } from "three";

/** The plain mesh of each skinned mesh, with the geometry that it copies (a new geometry gets a new plain mesh). */
const PLAIN = new WeakMap<SkinnedMesh, { readonly source: BufferGeometry; readonly plain: Mesh }>();

/** The plain mesh of a skinned mesh: made at the first pick of the mesh, then kept. */
function plainOf(mesh: SkinnedMesh): Mesh {
  const source = mesh.geometry;
  const known = PLAIN.get(mesh);
  if (known?.source === source) return known.plain;
  const geometry = new BufferGeometry();
  const count = source.getAttribute("position").count;
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setIndex(source.getIndex());
  for (const group of source.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.setDrawRange(source.drawRange.start, source.drawRange.count);
  const plain = new Mesh(geometry, mesh.material);
  plain.name = mesh.name;
  plain.matrixAutoUpdate = false;
  PLAIN.set(mesh, { source, plain });
  return plain;
}

/** The plain mesh of a skinned mesh with the positions of its current pose. */
export function posedMesh(mesh: SkinnedMesh): Mesh {
  const plain = plainOf(mesh);
  const position = plain.geometry.getAttribute("position") as BufferAttribute;
  const at = new Vector3();
  for (let i = 0; i < position.count; i += 1) {
    mesh.getVertexPosition(i, at);
    position.setXYZ(i, at.x, at.y, at.z);
  }
  position.needsUpdate = true;
  plain.material = mesh.material;
  plain.geometry.computeBoundingSphere();
  plain.geometry.computeBoundingBox();
  plain.matrixWorld.copy(mesh.matrixWorld);
  return plain;
}
