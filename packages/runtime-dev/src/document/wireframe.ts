// SPDX-License-Identifier: Apache-2.0
/**
 * The wireframe layer of a scene document: the meshes draw their triangle edges in place of their faces. The layer
 * sets `wireframe` on each material of the meshes of the scene graph (also the clones, the instance batches and the
 * skinned meshes). When the layer stops, it sets the old value again. A material that comes later (a load, a patch)
 * gets the value at the next frame.
 */
import type { Material, Mesh, Object3D } from "three";

/** A material with the wireframe switch (the mesh materials of three.js have it). */
type WireMaterial = Material & { wireframe?: boolean };

export class Wireframe {
  /** The materials that the layer changed, with their old value. */
  readonly #changed = new Map<WireMaterial, boolean>();

  /** Enable the wireframe of the meshes under `root`, or set the old values again. */
  apply(root: Object3D, on: boolean): void {
    if (!on) {
      this.clear();
      return;
    }
    root.traverse((node) => {
      if ((node as Partial<Mesh>).isMesh !== true) return;
      const material = (node as Mesh).material;
      for (const each of (Array.isArray(material) ? material : [material]) as WireMaterial[]) {
        if (this.#changed.has(each) || each.wireframe === undefined) continue;
        this.#changed.set(each, each.wireframe);
        each.wireframe = true;
      }
    });
  }

  /** Set the old value of each changed material again. */
  clear(): void {
    for (const [material, before] of this.#changed) material.wireframe = before;
    this.#changed.clear();
  }
}
