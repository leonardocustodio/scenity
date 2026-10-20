// SPDX-License-Identifier: Apache-2.0
/**
 * The ghosts of the proposals: a translucent copy of each prop that a proposal moves, at the place that the proposal
 * gives, beside the prop at its current place. A ring on the floor marks the target anchor of a team place event. The
 * lab page calculates the places from the proposed tune values with the place code of the scene. This layer only draws
 * them.
 *
 * A ghost is a view of the lab, not an input of a frame: it is not in the URL or in `frameKey`. Thus the pictures of
 * the core (the captures, the strip and the frame index) never show it: `suppress` hides it while the core draws them,
 * as the selection outline and the import previews. The pick skips it (pick.ts). The layer keeps no scene state between
 * frames: at each update, it reads the current prop object and the current place of the room kit.
 *
 * The copy of a prop: each visible mesh of the prop object (the model, else its graybox part) with one translucent
 * material. The copy is at the matrix of the mesh in the frame of the current place of the prop. The ghost group then
 * takes the proposed place, so the copy is where the prop goes after Accept (the runtime puts a prop model at its
 * place: core `applyProps`). The copies share the geometry of the prop; only the material is new.
 */
import type { Vec3 } from "@scenity/character/math";
import {
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  type BufferGeometry,
  type Object3D,
} from "three";
import { placeBox } from "./pick";
import { propObject } from "./selection";

/** One ghost that the lab page asks for: a prop at a proposed place, or a marker on the floor. */
export interface GhostSpec {
  /** The ID of the ghost: `<proposal>:<slot>`, or `<proposal>:place:<member>` for a marker. */
  readonly id: string;
  /** The ID of the proposal (or `staged` for a drag that the owner stages). */
  readonly proposal: string;
  /** "prop": a copy of the prop of `slot`; "marker": a ring on the floor at `at`. */
  readonly kind: "prop" | "marker";
  /** The prop slot of a prop ghost; null for a marker. */
  readonly slot: string | null;
  /** The proposed place of the prop (the base centre in the room, metres), or the centre of the marker. */
  readonly at: Vec3;
  /** The proposed turn about the vertical (radians). */
  readonly yaw: number;
}

/** A ghost as the layer draws it (the script API `ghosts()`, the tests). */
export interface GhostView extends GhostSpec {
  /** The count of the meshes of the copy (a marker: 1; a prop that the scene does not show: 0). */
  readonly meshes: number;
  /** The box of the copy in the frame of its place (as the pick gives `local`), or null for a marker or no copy. */
  readonly local: { readonly min: Vec3; readonly max: Vec3 } | null;
}

/** The name of the root of the ghosts in the scene: the pick skips it, and the lab marker gate finds it. */
export const GHOST_ROOT = "lab-proposal-ghosts";
/** The colour of the ghosts (a cyan that the scene does not use) and their opacity. */
const GHOST_COLOR = 0x38c8ff;
const GHOST_OPACITY = 0.38;
/** The ring of a marker: its inner and outer radius (metres) and its height over the floor. */
const RING = { inner: 0.18, outer: 0.24, lift: 0.006 } as const;

/** True when the object and each of its parents show. */
function shows(node: Object3D): boolean {
  for (let up: Object3D | null = node; up !== null; up = up.parent) if (!up.visible) return false;
  return true;
}

/** A ghost that the layer draws: its spec, its group and the prop object that its copy comes from. */
interface Drawn {
  readonly spec: GhostSpec;
  readonly group: Group;
  source: Object3D | null;
  meshes: number;
  local: GhostView["local"];
}

export class GhostLayer {
  readonly root = new Group();
  private readonly material = new MeshBasicMaterial({
    color: GHOST_COLOR,
    transparent: true,
    opacity: GHOST_OPACITY,
    depthWrite: false,
    side: DoubleSide,
  });
  private readonly ring: BufferGeometry = new RingGeometry(RING.inner, RING.outer, 48).rotateX(-Math.PI / 2);
  private drawn: Drawn[] = [];
  private suppressed = false;

  constructor() {
    this.root.name = GHOST_ROOT;
    // After the scene and before the outline (1002): a ghost does not hide the outline.
    this.root.renderOrder = 1001;
    this.root.visible = false;
  }

  /** Set the current ghosts and remove each other ghost. The next update makes the copies. */
  set(specs: readonly GhostSpec[]): void {
    this.clear();
    this.drawn = specs.map((spec) => {
      const group = new Group();
      group.name = `ghost:${spec.id}`;
      group.position.set(spec.at[0], spec.at[1], spec.at[2]);
      group.rotation.y = spec.yaw;
      this.root.add(group);
      if (spec.kind === "marker") {
        const ring = new Mesh(this.ring, this.material);
        ring.position.y = RING.lift;
        group.add(ring);
      }
      return { spec, group, source: null, meshes: spec.kind === "marker" ? 1 : 0, local: null };
    });
    this.show();
  }

  get size(): number {
    return this.drawn.length;
  }

  /**
   * Make the copy of each prop ghost again when its prop object changed (a model that loads in place of the graybox),
   * from the current scene and places of the room kit (after the update of the scene, as the outline).
   */
  update(scene: Object3D, places: Readonly<Record<string, { readonly at: Vec3; readonly yaw: number }>>): void {
    for (const item of this.drawn) {
      if (item.spec.kind !== "prop" || item.spec.slot === null) continue;
      const source = propObject(scene, item.spec.slot);
      const place = places[item.spec.slot];
      if (source === item.source) continue;
      for (const child of [...item.group.children]) item.group.remove(child);
      item.source = source;
      item.meshes = 0;
      item.local = null;
      if (source === null || place === undefined) continue;
      this.copy(item, source, place);
    }
  }

  /** The copy of a prop object in a ghost group: each visible mesh at its matrix in the frame of the current place. */
  private copy(item: Drawn, source: Object3D, place: { readonly at: Vec3; readonly yaw: number }): void {
    const toPlace = new Matrix4().makeRotationY(place.yaw).setPosition(place.at[0], place.at[1], place.at[2]).invert();
    source.updateWorldMatrix(true, true);
    source.traverse((node) => {
      const mesh = node as Partial<Mesh>;
      if (mesh.isMesh !== true || mesh.geometry === undefined || !shows(node)) return;
      const ghost = new Mesh(mesh.geometry, this.material);
      ghost.matrixAutoUpdate = false;
      ghost.matrix.multiplyMatrices(toPlace, node.matrixWorld);
      ghost.renderOrder = this.root.renderOrder;
      item.group.add(ghost);
      item.meshes += 1;
    });
    item.local = item.meshes === 0 ? null : placeBox(source, place);
  }

  /** The ghosts as the layer draws them. */
  list(): GhostView[] {
    return this.drawn.map((item) => ({ ...item.spec, meshes: item.meshes, local: item.local }));
  }

  /** Hide the ghosts while the core draws a picture of a frame (true), and show them again (false). */
  suppress(on: boolean): void {
    this.suppressed = on;
    this.show();
  }

  private show(): void {
    this.root.visible = !this.suppressed && this.drawn.length > 0;
  }

  private clear(): void {
    for (const item of this.drawn) this.root.remove(item.group);
    this.drawn = [];
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
    this.ring.dispose();
    this.root.removeFromParent();
  }
}
