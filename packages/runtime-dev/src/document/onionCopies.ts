// SPDX-License-Identifier: Apache-2.0
/**
 * The onion skins of the Scene view: faint copies of an entity at times near the clock time, so the person sees a
 * motion in one frame. The editor poses the open sequence at each time and gives the world matrix of the entity at
 * that time. This layer copies each visible mesh of the entity (and of its children) to that place. A copy before the
 * clock time is blue, and a copy after it is orange. The opacity decreases with the distance. The copies share the
 * geometry of the meshes; only the materials are new. A pick ignores them (no raycast), and the camera previews hide
 * them. A spec with no copies removes them.
 */
import { Color, Group, Matrix4, Mesh, MeshBasicMaterial, type Object3D } from "three";

/** One copy: the world matrix of the entity (column order, 16 numbers), its side of the clock time and its opacity. */
export interface OnionCopy {
  readonly matrix: readonly number[];
  readonly side: "before" | "after";
  readonly opacity: number;
}

/** The onion skins that the page asks for. */
export interface OnionCopiesSpec {
  readonly entity: string;
  readonly copies: readonly OnionCopy[];
}

/** The colours of the two sides (a copy of a tool view, not a look of the scene). */
const TONES = { before: new Color(0x4f9dff), after: new Color(0xff9f1a) } as const;

/** A plain copy of a spec (a message keeps no class). */
export function plainOnion(spec: OnionCopiesSpec | null): OnionCopiesSpec | null {
  if (spec === null) return null;
  return {
    entity: spec.entity,
    copies: spec.copies.map((copy) => ({ matrix: [...copy.matrix], side: copy.side, opacity: copy.opacity })),
  };
}

export class OnionCopies {
  readonly group = new Group();
  #spec: OnionCopiesSpec | null = null;
  #dirty = false;

  constructor() {
    this.group.name = "scenity-onion";
    this.group.matrixAutoUpdate = false;
  }

  /** The count of the current copy meshes. */
  get count(): number {
    return this.group.children.length;
  }

  set(spec: OnionCopiesSpec | null): void {
    this.#spec = spec === null || spec.copies.length === 0 ? null : spec;
    this.#dirty = true;
  }

  /** Make the copies again after a new spec, from the current object of the entity (no copies with no such entity). */
  apply(scene: Object3D, entity: (id: string) => Object3D | undefined): void {
    if (this.group.parent !== scene) scene.add(this.group);
    if (!this.#dirty) return;
    this.#dirty = false;
    this.#clear();
    const spec = this.#spec;
    const root = spec === null ? undefined : entity(spec.entity);
    if (spec === null || root === undefined) return;
    root.updateWorldMatrix(true, true);
    const inverse = new Matrix4().copy(root.matrixWorld).invert();
    const meshes: Mesh[] = [];
    root.traverseVisible((node) => {
      if (node instanceof Mesh && node.name !== "scenity-pick") meshes.push(node as Mesh);
    });
    for (const copy of spec.copies) {
      const place = new Matrix4().fromArray([...copy.matrix]);
      const material = new MeshBasicMaterial({
        color: TONES[copy.side],
        transparent: true,
        opacity: copy.opacity,
        depthWrite: false,
      });
      for (const mesh of meshes) {
        const clone = new Mesh(mesh.geometry, material);
        clone.matrixAutoUpdate = false;
        // The mesh keeps its place in the entity: the world matrix of the copy, then the mesh from the entity.
        clone.matrix.multiplyMatrices(place, new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
        clone.raycast = () => undefined;
        clone.renderOrder = 10;
        this.group.add(clone);
      }
    }
    this.group.updateMatrixWorld(true);
  }

  /** Show or hide the copies (a camera preview hides them). */
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
