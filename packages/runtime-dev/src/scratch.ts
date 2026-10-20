// SPDX-License-Identifier: Apache-2.0
/**
 * The scratch props of the lab: the model of an import job of the workbench host, placed in the room as a prop of the
 * checkout. A scratch prop is a lab input: the lab URL names it (`scratch=<import>@x,y,z,turn`), the key of a frame
 * holds it, and so every picture of the core shows it (the captures, the strip, the frame index), unlike the import
 * previews (preview.ts). Only the labs core draws a scratch prop: the learner build has no scratch code (the lab marker
 * gate).
 *
 * The page gives the models one time (plain meshes, preview.ts) and the places at each change. A drag changes the
 * places often: a place is a group, and the places of one model share its geometry and its materials.
 */
import type { Vec3 } from "@scenity/character/math";
import { Group, type Mesh, type Object3D } from "three";
import { disposeMesh, meshOf, type PreviewMesh } from "./preview";

/**
 * The model of an import (`preview.glb` of the import job), in the frame of the model: the base centre at the origin.
 */
export interface ScratchModel {
  /** The import ID. */
  readonly id: string;
  readonly meshes: readonly PreviewMesh[];
}

/** A scratch prop in the room. */
export interface ScratchPlace {
  /** The ID of the scratch prop: `scratch-<n>`. */
  readonly id: string;
  /** The import ID of its model. */
  readonly model: string;
  /** The base centre in the room (metres). */
  readonly at: Vec3;
  /** The turn about the vertical axis (radians). */
  readonly yaw: number;
}

/** A change of the scratch props: the models (when they change) and the places. */
export interface ScratchUpdate {
  /** All the current models; absent: the models stay. */
  readonly models?: readonly ScratchModel[];
  readonly places: readonly ScratchPlace[];
}

/** The name of the root of the scratch props in the scene. */
export const SCRATCH_ROOT = "lab-scratch-props";
/** The prefix of the name of a scratch prop group: the pick and the outline find the prop by it. */
export const SCRATCH_PREFIX = "scratch:";

/** The place of a scratch prop group: its position and its turn. */
export function scratchPlaceOf(group: Object3D): { readonly at: Vec3; readonly yaw: number } {
  return { at: [group.position.x, group.position.y, group.position.z], yaw: group.rotation.y };
}

/** The scratch props in the scene: one group per place, with the meshes of its model. */
export class ScratchLayer {
  readonly root = new Group();
  /** The meshes of each model; the groups of the places share their geometry and materials. */
  private readonly models = new Map<string, readonly Mesh[]>();

  constructor() {
    this.root.name = SCRATCH_ROOT;
    this.root.visible = false;
  }

  /** A new layer in a scene. */
  static addTo(scene: Object3D): ScratchLayer {
    const layer = new ScratchLayer();
    scene.add(layer.root);
    return layer;
  }

  /** The count of the scratch props that show. */
  get size(): number {
    return this.root.children.length;
  }

  /** The IDs of the models that the layer has. */
  get modelIds(): readonly string[] {
    return [...this.models.keys()];
  }

  /**
   * Set the models (when given) and the current places. A place of a model that the layer does not have does not show.
   */
  set(update: ScratchUpdate): void {
    if (update.models !== undefined) this.setModels(update.models);
    this.clearPlaces();
    for (const place of update.places) {
      const meshes = this.models.get(place.model);
      if (meshes === undefined) continue;
      const group = new Group();
      group.name = `${SCRATCH_PREFIX}${place.id}`;
      group.position.set(place.at[0], place.at[1], place.at[2]);
      group.rotation.y = place.yaw;
      // A clone of a mesh shares its geometry and its material.
      for (const mesh of meshes) group.add(mesh.clone());
      this.root.add(group);
    }
    this.root.visible = this.root.children.length > 0;
  }

  /** Keep the models of the list: a model with a known ID stays as it is (an import never changes). */
  private setModels(models: readonly ScratchModel[]): void {
    const keep = new Set(models.map((model) => model.id));
    for (const [id, meshes] of this.models) {
      if (keep.has(id)) continue;
      for (const mesh of meshes) disposeMesh(mesh);
      this.models.delete(id);
    }
    for (const model of models) {
      if (!this.models.has(model.id)) this.models.set(model.id, model.meshes.map(meshOf));
    }
  }

  private clearPlaces(): void {
    for (const group of [...this.root.children]) this.root.remove(group);
  }

  dispose(): void {
    this.clearPlaces();
    for (const meshes of this.models.values()) for (const mesh of meshes) disposeMesh(mesh);
    this.models.clear();
    this.root.removeFromParent();
  }
}
