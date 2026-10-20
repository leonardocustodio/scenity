// SPDX-License-Identifier: Apache-2.0
/**
 * The quick preview of a dropped model: the three.js loaders of the labs read a GLTF, GLB, OBJ or FBX file on the main
 * thread of the lab page, and `previewModel` makes the plain meshes that the labs core shows at the drop point
 * (preview.ts). No Blender, no optimization and no file: the lab page alone shows it as "preview, not optimized"; the
 * workbench host gives the optimized model of its import job the same way (its `preview.glb`).
 *
 * The meshes go into the frame of the model: the transforms applied, metres (an OBJ or FBX file larger than 10 units is
 * in centimetres, larger than 1,000 in millimetres, as the import does), the base centre at the origin.
 * The lab page loads this module only when a file comes (`@scenity/runtime-dev/previewLoad`, a dynamic import), and
 * the loaders load only for their format, so the lab page does not grow at its start.
 */
import type { Vec3 } from "@scenity/character/math";
import {
  Box3,
  Matrix4,
  SRGBColorSpace,
  Vector3,
  type BufferAttribute,
  type BufferGeometry,
  type Mesh,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import type { PreviewMesh, PreviewModel } from "./preview";
import { PREVIEW_FORMATS, previewFormat, type PreviewFormat } from "./previewFormats";

/** The largest model of a preview (triangles): a larger file waits for the import job. */
export const PREVIEW_MAX_TRIANGLES = 2_000_000;
/** The largest texture edge of a preview (px). */
const PREVIEW_TEXTURE = 1024;

/** The scale to metres of a model of a size (units): the rule of the import for files without units. */
export function unitScale(size: number, format: PreviewFormat): number {
  if (format === ".glb" || format === ".gltf") return 1;
  if (size > 1000) return 0.001;
  if (size > 10) return 0.01;
  return 1;
}

/** Read the bytes of a file into a three.js object with the loader of its format. */
export async function loadObject(bytes: ArrayBuffer, name: string): Promise<Object3D> {
  const format = previewFormat(name);
  if (format === null) throw new Error(`${name}: the lab previews ${PREVIEW_FORMATS.join(", ")}`);
  if (format === ".obj") {
    const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
    return new OBJLoader().parse(new TextDecoder().decode(bytes));
  }
  if (format === ".fbx") {
    const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
    return new FBXLoader().parse(bytes, "");
  }
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import("three/examples/jsm/loaders/GLTFLoader.js"),
    import("three/examples/jsm/libs/meshopt_decoder.module.js"),
  ]);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(bytes, "");
  return gltf.scene;
}

/** The pixels of a texture as an `ImageBitmap` in the orientation of the UVs (no flip in the core), or null. */
async function bitmapOf(texture: Texture | null | undefined): Promise<ImageBitmap | null> {
  const image = texture?.image as (CanvasImageSource & { decode?: () => Promise<void> }) | null | undefined;
  if (texture === null || texture === undefined || image === null || image === undefined) return null;
  try {
    if (image instanceof HTMLImageElement) {
      await image.decode();
      if (image.naturalWidth === 0) return null;
    }
    const { width, height } = image as unknown as { width: number; height: number };
    const scale = Math.min(1, PREVIEW_TEXTURE / Math.max(width, height, 1));
    return await createImageBitmap(image, {
      imageOrientation: texture.flipY ? "flipY" : "from-image",
      resizeWidth: Math.max(1, Math.round(width * scale)),
      resizeHeight: Math.max(1, Math.round(height * scale)),
    });
  } catch {
    return null;
  }
}

function arrayOf(geometry: BufferGeometry, name: string, size: number): Float32Array | null {
  const attribute = geometry.getAttribute(name) as BufferAttribute | undefined;
  if (attribute?.itemSize !== size) return null;
  return Float32Array.from({ length: attribute.count * size }, (_, i) =>
    attribute.getComponent(Math.floor(i / size), i % size),
  );
}

/** The plain parts of one mesh, one per material group, in the frame `matrix`. */
async function meshParts(mesh: Mesh, matrix: Matrix4): Promise<PreviewMesh[]> {
  const geometry = mesh.geometry.clone().applyMatrix4(new Matrix4().multiplyMatrices(matrix, mesh.matrixWorld));
  const positions = arrayOf(geometry, "position", 3);
  if (positions === null) return [];
  const count = positions.length / 3;
  const index = geometry.getIndex();
  const all = index === null ? Uint32Array.from({ length: count }, (_, i) => i) : Uint32Array.from(index.array);
  const normals = arrayOf(geometry, "normal", 3);
  const uvs = arrayOf(geometry, "uv", 2);
  const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const groups = geometry.groups.length > 0 ? geometry.groups : [{ start: 0, count: all.length, materialIndex: 0 }];
  geometry.dispose();
  const parts: PreviewMesh[] = [];
  for (const group of groups) {
    const material = materials[group.materialIndex ?? 0] ?? materials[0];
    const standard = material as Material & {
      color?: {
        r: number;
        g: number;
        b: number;
        getRGB(target: object, space: string): { r: number; g: number; b: number };
      };
      map?: Texture | null;
    };
    const color = standard.color?.getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace) ?? { r: 0.7, g: 0.7, b: 0.7 };
    parts.push({
      positions,
      normals,
      uvs,
      indices: all.slice(group.start, group.start + Math.min(group.count, all.length - group.start)),
      color: [color.r, color.g, color.b],
      opacity: material?.transparent === true ? material.opacity : 1,
      texture: uvs === null ? null : await bitmapOf(standard.map),
    });
  }
  return parts;
}

/** True for a mesh of the loaded object. */
function isMesh(item: Object3D): item is Mesh {
  return (item as Partial<Mesh>).isMesh === true;
}

/** Free the GPU parts of the loaded object (the preview keeps only plain arrays and bitmaps). */
function disposeObject(root: Object3D): void {
  root.traverse((item) => {
    if (!isMesh(item)) return;
    item.geometry.dispose();
    for (const material of Array.isArray(item.material) ? item.material : [item.material]) {
      (material as { map?: Texture | null }).map?.dispose();
      material.dispose();
    }
  });
}

/** A loaded object as a preview model at a drop point: the base centre at the origin, in metres. */
export async function previewModel(
  root: Object3D,
  info: { readonly id: string; readonly name: string; readonly at: Vec3; readonly format: PreviewFormat },
): Promise<PreviewModel & { readonly scale: number; readonly triangles: number }> {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  if (box.isEmpty()) throw new Error(`${info.name}: the file has no mesh`);
  const size = box.getSize(new Vector3());
  const scale = unitScale(Math.max(size.x, size.y, size.z), info.format);
  const base = new Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
  const matrix = new Matrix4().makeScale(scale, scale, scale).multiply(new Matrix4().makeTranslation(base.negate()));
  const meshes: Mesh[] = [];
  root.traverse((item) => {
    if (isMesh(item) && item.visible) meshes.push(item);
  });
  const triangles = meshes.reduce((sum, mesh) => {
    const geometry = mesh.geometry;
    return sum + (geometry.getIndex()?.count ?? geometry.getAttribute("position").count) / 3;
  }, 0);
  if (triangles > PREVIEW_MAX_TRIANGLES) {
    disposeObject(root);
    throw new Error(`${info.name}: ${String(Math.round(triangles))} triangles, too many for a quick preview`);
  }
  const parts: PreviewMesh[] = [];
  for (const mesh of meshes) parts.push(...(await meshParts(mesh, matrix)));
  disposeObject(root);
  return { id: info.id, name: info.name, at: info.at, yaw: 0, meshes: parts, scale, triangles: Math.round(triangles) };
}
