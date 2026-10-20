// SPDX-License-Identifier: Apache-2.0
/**
 * The ghosts of the changes that wait: a faint copy of each entity that a change set of an agent moves. The copy is at
 * the new place, in the colour of the session of the change, so the person sees where the entity goes before a review.
 * The page gives the world matrix of each entity in the document after the change sets. This layer copies each visible
 * mesh of the entity to that place, as the onion skins do (onionCopies.ts). The copies share the geometry of the
 * meshes; only the materials are new. A pick ignores them, and the camera previews hide them. A spec with no copies
 * removes them.
 */
import { Color, Group, Matrix4, Mesh, MeshBasicMaterial, type Object3D } from "three";

/** One ghost: the entity, its world matrix after the change (column order, 16 numbers) and a CSS hex colour. */
export interface GhostCopy {
  readonly entity: string;
  readonly matrix: readonly number[];
  readonly colour: string;
}

/** The ghosts that the page asks for. */
export interface GhostSpec {
  readonly copies: readonly GhostCopy[];
}

/** The opacity of a ghost. */
const OPACITY = 0.35;

/** A plain copy of a spec (a message keeps no class). */
export function plainGhosts(spec: GhostSpec | null): GhostSpec | null {
  if (spec === null) return null;
  return {
    copies: spec.copies.map((copy) => ({ entity: copy.entity, matrix: [...copy.matrix], colour: copy.colour })),
  };
}

export class GhostCopies {
  readonly group = new Group();
  #spec: GhostSpec | null = null;
  #dirty = false;

  constructor() {
    this.group.name = "scenity-ghosts";
    this.group.matrixAutoUpdate = false;
  }

  /** The count of the current ghost meshes. */
  get count(): number {
    return this.group.children.length;
  }

  set(spec: GhostSpec | null): void {
    this.#spec = spec === null || spec.copies.length === 0 ? null : spec;
    this.#dirty = true;
  }

  /**
   * Make the ghosts again after a new spec, from the current objects of the entities (an entity with none: no ghost).
   */
  apply(scene: Object3D, entity: (id: string) => Object3D | undefined): void {
    if (this.group.parent !== scene) scene.add(this.group);
    if (!this.#dirty) return;
    this.#dirty = false;
    this.#clear();
    for (const copy of this.#spec?.copies ?? []) {
      const root = entity(copy.entity);
      if (root === undefined) continue;
      root.updateWorldMatrix(true, true);
      const inverse = new Matrix4().copy(root.matrixWorld).invert();
      const place = new Matrix4().fromArray([...copy.matrix]);
      const material = new MeshBasicMaterial({
        color: new Color(copy.colour),
        transparent: true,
        opacity: OPACITY,
        depthWrite: false,
      });
      root.traverseVisible((node) => {
        if (!(node instanceof Mesh) || node.name === "scenity-pick") return;
        const clone = new Mesh((node as Mesh).geometry, material);
        clone.matrixAutoUpdate = false;
        // The mesh keeps its place in the entity: the world matrix of the ghost, then the mesh from the entity.
        clone.matrix.multiplyMatrices(place, new Matrix4().multiplyMatrices(inverse, node.matrixWorld));
        clone.raycast = () => undefined;
        clone.renderOrder = 10;
        this.group.add(clone);
      });
    }
    this.group.updateMatrixWorld(true);
  }

  /** Show or hide the ghosts (a camera preview hides them). */
  show(visible: boolean): void {
    this.group.visible = visible;
  }

  #clear(): void {
    const materials = new Set<MeshBasicMaterial>();
    for (const child of this.group.children) {
      if (child instanceof Mesh && child.material instanceof MeshBasicMaterial) materials.add(child.material);
    }
    for (const material of materials) material.dispose();
    this.group.clear();
  }
}
