// SPDX-License-Identifier: Apache-2.0
/**
 * The model steps of the import in glTF Transform: the up axis, the scale, the merge, the decimate and the
 * origin. The direct glTF path runs all of them. After Blender, the steps run only for the settings that the Blender
 * script did not apply.
 */
import type { Document } from "@gltf-transform/core";
import { center, dedup, flatten, getBounds, join, simplifyPrimitive, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import { modelStats } from "../build/optimize";
import { decimateSpecs, type ModelImportSettings } from "./settings";

/** The steps that run: the Blender paths apply the scale (and the recipe also the decimate) in Blender. */
export interface ModelSteps {
  readonly scale: boolean;
  readonly decimate: boolean;
}

type Quat = [number, number, number, number];

/** A quarter turn about -X: the +Z axis of the model points up (+Y) after it. */
const Z_UP_TO_Y_UP: Quat = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];

/** The product a × b of two quaternions [x, y, z, w]: first b, then a. */
function multiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** The vector v turned by the quaternion q. */
function rotate(q: Quat, v: readonly number[]): [number, number, number] {
  const [x, y, z] = multiply(multiply(q, [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, 0]), [-q[0], -q[1], -q[2], q[3]]);
  return [x, y, z];
}

/** Turn and scale each root node about the origin of the scene. The scale is uniform, so the result is exact. */
function turnAndScale(document: Document, turn: boolean, scale: number): void {
  if (!turn && scale === 1) return;
  const q: Quat = turn ? Z_UP_TO_Y_UP : [0, 0, 0, 1];
  for (const scene of document.getRoot().listScenes()) {
    for (const node of scene.listChildren()) {
      const [tx, ty, tz] = rotate(q, node.getTranslation());
      const [sx, sy, sz] = node.getScale();
      node.setTranslation([tx * scale, ty * scale, tz * scale]);
      node.setRotation(multiply(q, node.getRotation()));
      node.setScale([sx * scale, sy * scale, sz * scale]);
    }
  }
}

/** Reduce each mesh over `above` triangles to `ratio` of its triangles (meshoptimizer). */
function decimateMeshes(document: Document, settings: ModelImportSettings): void {
  for (const spec of decimateSpecs(settings)) {
    if (spec.ratio === undefined) continue;
    for (const mesh of document.getRoot().listMeshes()) {
      const triangles = mesh.listPrimitives().reduce((sum, primitive) => {
        const count = primitive.getIndices()?.getCount() ?? primitive.getAttribute("POSITION")?.getCount() ?? 0;
        return sum + Math.floor(count / 3);
      }, 0);
      if (triangles <= spec.above) continue;
      for (const primitive of mesh.listPrimitives()) {
        simplifyPrimitive(primitive, { simplifier: MeshoptSimplifier, ratio: spec.ratio, error: 0.01 });
      }
    }
  }
}

/** Apply the model settings to a document, in place. */
export async function applyModelSteps(
  document: Document,
  settings: ModelImportSettings,
  steps: ModelSteps,
): Promise<void> {
  const scale = steps.scale && typeof settings.scale === "number" ? settings.scale : 1;
  turnAndScale(document, settings.up === "z", scale);
  if (settings.merge) await document.transform(dedup({ keepUniqueNames: true }), flatten(), join({ keepNamed: false }));
  if (steps.decimate && settings.decimate !== undefined) {
    await MeshoptSimplifier.ready;
    await document.transform(weld());
    decimateMeshes(document, settings);
  }
  if (settings.origin === "base-centre") await document.transform(center({ pivot: "below" }));
  if (settings.origin === "centre") await document.transform(center({ pivot: "center" }));
}

/** The size of a model in metres: x, the height, the depth. */
export function extentOf(document: Document): [number, number, number] {
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
  if (scene === undefined) return [0, 0, 0];
  const { min, max } = getBounds(scene);
  const size = (axis: 0 | 1 | 2): number => Math.round((max[axis] - min[axis]) * 10_000) / 10_000;
  return [size(0), size(1), size(2)];
}

/**
 * The report of a model: the meshes, the triangles, the size and the texture types. It also has the names of the
 * clips and the joints of the largest skin (0: no skin), for the facts of the asset inspector.
 */
export function modelReport(document: Document): Record<string, unknown> {
  const stats = modelStats(document);
  const root = document.getRoot();
  const textures = root.listTextures().map((texture) => texture.getMimeType());
  return {
    meshes: stats.meshes,
    triangles: stats.triangles,
    extent: extentOf(document),
    textures: [...new Set(textures)].sort(),
    clips: root.listAnimations().map((animation, index) => animation.getName() || `clip ${String(index + 1)}`),
    joints: Math.max(0, ...root.listSkins().map((skin) => skin.listJoints().length)),
  };
}
