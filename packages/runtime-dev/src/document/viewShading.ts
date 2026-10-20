// SPDX-License-Identifier: Apache-2.0
/**
 * The shading modes of the editor viewport. "unlit" draws each mesh with the colour, the colour map and the alpha of
 * its material and no light. "normalShading" draws the world normals as colours. The dev document core enables a mode
 * as a core layer of the same name. The wireframe mode is in wireframe.ts.
 *
 * Each mode puts a material of its own on each mesh under the root (also the clones, the instance batches and the
 * skinned meshes) and keeps the material before it. When the mode stops, each mesh gets its material again. A mesh
 * that comes later (a load, a patch, a new instance batch) gets the mode at the next frame.
 */
import { MeshBasicMaterial, MeshNormalMaterial, type Material, type Mesh, type Object3D } from "three";

/** A shading mode of the viewport. */
export type ShadingMode = "unlit" | "normalShading";

/** The layer names of the shading modes. */
export const SHADING_MODES: readonly ShadingMode[] = ["unlit", "normalShading"];

/** The fields of a mesh material that the unlit material copies (the mesh materials of three.js have them). */
type SourceMaterial = Material &
  Partial<Pick<MeshBasicMaterial, "color" | "map" | "alphaMap" | "vertexColors" | "wireframe">>;

/** The material of a mode for a material of the scene. */
function made(mode: ShadingMode, source: SourceMaterial): Material {
  const common = {
    side: source.side,
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    wireframe: source.wireframe ?? false,
  };
  if (mode === "normalShading") return new MeshNormalMaterial(common);
  const unlit = new MeshBasicMaterial({ ...common, vertexColors: source.vertexColors });
  if (source.color !== undefined) unlit.color.copy(source.color);
  unlit.map = source.map ?? null;
  unlit.alphaMap = source.alphaMap ?? null;
  return unlit;
}

export class ViewShading {
  #mode: ShadingMode | null = null;
  /** The material of the mode for each material of the scene. */
  readonly #made = new Map<Material, Material>();
  /** The material of the scene for each material of the mode. */
  readonly #source = new Map<Material, Material>();

  /** Put the materials of a mode on the meshes under `root`, or the materials of the scene back (null). */
  apply(root: Object3D, mode: ShadingMode | null): void {
    if (mode !== this.#mode) this.clear(root);
    this.#mode = mode;
    if (mode === null) return;
    root.traverse((node) => {
      if ((node as Partial<Mesh>).isMesh !== true) return;
      const mesh = node as Mesh;
      mesh.material = this.#map(mesh.material, (material) => this.#of(mode, material));
    });
  }

  /**
   * Put the material of the scene back on each mesh under `root`, and keep the mode and the materials of the mode.
   * The next `apply` of the same mode uses the same materials again (a pane of the split view in each frame).
   */
  restore(root: Object3D): void {
    if (this.#source.size === 0) return;
    root.traverse((node) => {
      if ((node as Partial<Mesh>).isMesh !== true) return;
      const mesh = node as Mesh;
      mesh.material = this.#map(mesh.material, (material) => this.#source.get(material) ?? material);
    });
  }

  /** Put the material of the scene back on each mesh under `root`, and forget the materials of the mode. */
  clear(root: Object3D): void {
    if (this.#source.size === 0) return;
    root.traverse((node) => {
      if ((node as Partial<Mesh>).isMesh !== true) return;
      const mesh = node as Mesh;
      mesh.material = this.#map(mesh.material, (material) => this.#source.get(material) ?? material);
    });
    for (const material of this.#source.keys()) material.dispose();
    this.#made.clear();
    this.#source.clear();
    this.#mode = null;
  }

  #map(material: Material | Material[], change: (material: Material) => Material): Material | Material[] {
    return Array.isArray(material) ? material.map(change) : change(material);
  }

  /** The material of the mode for a material (a material of the mode stays). */
  #of(mode: ShadingMode, material: Material): Material {
    if (this.#source.has(material)) return material;
    let own = this.#made.get(material);
    if (own === undefined) {
      own = made(mode, material);
      this.#made.set(material, own);
      this.#source.set(own, material);
    }
    return own;
  }
}
