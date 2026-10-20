// SPDX-License-Identifier: Apache-2.0
/**
 * The import previews of the lab: a model that the owner dropped on the scene shows at the drop point until its scratch
 * prop exists. The lab page reads the file with the three.js loaders (on the main thread: the loaders need the DOM) and
 * gives the core plain meshes: typed arrays, a color and an `ImageBitmap` of the color texture. A worker message
 * carries them, so the preview is the same in the worker and on the main thread, and on both backends (a standard
 * material).
 *
 * A preview is not an input of a frame (it is not in the URL or in `frameKey`), so the pictures of the core (the
 * captures, the strip and the frame index) never show it: `suppress` hides it while the core draws them. The canvas
 * that the owner sees shows it.
 */
import type { Vec3 } from "@scenity/character/math";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  Texture,
} from "three";

/** One mesh of a preview model, in the frame of the model (metres, Y up, the base centre at the origin). */
export interface PreviewMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array | null;
  readonly uvs: Float32Array | null;
  readonly indices: Uint32Array | null;
  /** The base color (sRGB, 0 to 1). */
  readonly color: readonly [number, number, number];
  readonly opacity: number;
  /** The base color texture, in the orientation of the UVs (no flip), or null. */
  readonly texture: ImageBitmap | null;
}

/** A dropped model at its drop point. */
export interface PreviewModel {
  readonly id: string;
  readonly name: string;
  /** The drop point in the room (metres): the base centre of the model goes there. */
  readonly at: Vec3;
  /** The turn about the vertical axis (radians). */
  readonly yaw: number;
  readonly meshes: readonly PreviewMesh[];
}

/** The name of the root of the previews in the scene (the pick and the tests find it). */
export const PREVIEW_ROOT = "lab-import-previews";

/** A three.js mesh of one plain mesh (the scratch props also use it, scratch.ts). */
export function meshOf(part: PreviewMesh): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(part.positions, 3));
  if (part.normals !== null) geometry.setAttribute("normal", new BufferAttribute(part.normals, 3));
  if (part.uvs !== null) geometry.setAttribute("uv", new BufferAttribute(part.uvs, 2));
  if (part.indices !== null) geometry.setIndex(new BufferAttribute(part.indices, 1));
  if (part.normals === null) geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new MeshStandardMaterial({
    color: new Color().setRGB(part.color[0], part.color[1], part.color[2], SRGBColorSpace),
    roughness: 0.8,
    metalness: 0,
    side: DoubleSide,
    transparent: part.opacity < 1,
    opacity: part.opacity,
  });
  if (part.texture !== null) {
    const texture = new Texture(part.texture);
    texture.flipY = false;
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    material.map = texture;
  }
  return new Mesh(geometry, material);
}

/** Free the GPU parts of a mesh. The page owns the bitmaps: a new renderer gets the same models again. */
export function disposeMesh(mesh: Mesh): void {
  mesh.geometry.dispose();
  const material = mesh.material as MeshStandardMaterial;
  material.map?.dispose();
  material.dispose();
}

/** The previews in the scene: one group per model at its drop point. */
export class PreviewLayer {
  readonly root = new Group();
  private suppressed = false;

  constructor() {
    this.root.name = PREVIEW_ROOT;
    this.root.visible = false;
  }

  /** Set the current models and remove each other model. */
  set(models: readonly PreviewModel[]): void {
    this.clear();
    for (const model of models) {
      const group = new Group();
      group.name = `preview:${model.id}`;
      group.position.set(model.at[0], model.at[1], model.at[2]);
      group.rotation.y = model.yaw;
      for (const part of model.meshes) group.add(meshOf(part));
      this.root.add(group);
    }
    this.show();
  }

  /** The count of models. */
  get size(): number {
    return this.root.children.length;
  }

  /** Hide the previews while the core draws a picture of a frame (true), and show them again (false). */
  suppress(on: boolean): void {
    this.suppressed = on;
    this.show();
  }

  private show(): void {
    this.root.visible = !this.suppressed && this.root.children.length > 0;
  }

  private clear(): void {
    for (const group of [...this.root.children]) {
      group.traverse((item) => {
        if ((item as Partial<Mesh>).isMesh === true) disposeMesh(item as Mesh);
      });
      this.root.remove(group);
    }
  }

  dispose(): void {
    this.clear();
    this.root.removeFromParent();
  }
}

/** A layer of the lab over the scene that a picture of the core must not show (the outline, the previews). */
export interface HiddenLayer {
  readonly root: { readonly visible: boolean };
  suppress(on: boolean): void;
}

/**
 * Hide each visible layer for a picture of the core. Returns the function that shows them again, or
 * null when no layer was visible (the frame then needs no second render).
 */
export function hideLayers(layers: readonly (HiddenLayer | null)[]): (() => void) | null {
  const shown = layers.filter((layer): layer is HiddenLayer => layer?.root.visible === true);
  if (shown.length === 0) return null;
  for (const layer of shown) layer.suppress(true);
  return () => {
    for (const layer of shown) layer.suppress(false);
  };
}
