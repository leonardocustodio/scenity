// SPDX-License-Identifier: Apache-2.0
/**
 * The selection outline of the labs: a box of lines around the selected prop, member or item of a plugin kind, over the
 * scene (no depth test), as the debug layers. A prop gets a box in the frame of its place, so the box turns with the
 * prop. A member gets a box around its joints. Another object gets its box in the room. The core updates the box after
 * each update of the scene, so a tuned place moves the box with the prop. A selection of many items gets one box for
 * each item. The graybox part of a prop slot and the object of a plugin kind come from the classifiers of the plugins
 * (pickKinds.ts).
 */
import type { Vec3 } from "@scenity/character/math";
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Vector3,
  type Object3D,
} from "three";
import type { Joints } from "./inspect";
import { placeBox } from "./pick";
import type { SelectTarget } from "./pickMath";
import { firstAnswer } from "./pickKinds";
import { SCRATCH_PREFIX, scratchPlaceOf } from "./scratch";

export type { SelectTarget } from "./pickMath";

/** The colour of the outline (an orange that the scene does not use). */
const OUTLINE_COLOR = 0xff8a00;
/** The space around a member box (metres). */
const MEMBER_MARGIN = 0.12;
/** The 12 edges of a box: the indices of its 8 corners (bit 0: x, bit 1: y, bit 2: z). */
const EDGES = [0, 1, 1, 3, 3, 2, 2, 0, 4, 5, 5, 7, 7, 6, 6, 4, 0, 4, 1, 5, 2, 6, 3, 7];

/**
 * The object of a prop slot in the scene: the model when it shows, else the graybox part that a plugin names, else the
 * node `graybox-<slot>`.
 */
export function propObject(scene: Object3D, slot: string): Object3D | null {
  const model = scene.getObjectByName(`prop-${slot}`);
  if (model?.visible === true) return model;
  const named = firstAnswer((classifier) => classifier.propObject?.(scene, slot));
  return named !== undefined ? named : (scene.getObjectByName(`graybox-${slot}`) ?? null);
}

/** The parts of the core that the outline reads. */
export interface OutlineInput {
  readonly scene: Object3D;
  readonly places: Readonly<Record<string, { readonly at: Vec3; readonly yaw: number }>>;
  /** The joints of each drawn member. */
  readonly members: ReadonlyMap<string, Joints>;
}

export class SelectionOutline {
  readonly root: LineSegments;
  /** The selected items (the first is the item of the card). */
  private targets: readonly SelectTarget[] = [];
  /** The last update found the target. */
  private found = false;
  /** True while the core draws a picture for a tool or the index: the picture has no outline. */
  private suppressed = false;

  constructor() {
    this.root = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({ color: OUTLINE_COLOR, depthTest: false, transparent: true }),
    );
    this.root.name = "selection-outline";
    this.root.renderOrder = 1002;
    this.root.frustumCulled = false;
    this.root.visible = false;
  }

  get active(): boolean {
    return this.targets.length > 0;
  }

  /** Set the selected item, the list of the selected items, or nothing (null). */
  set(target: SelectTarget | readonly SelectTarget[] | null): void {
    if (target === null) this.targets = [];
    else this.targets = Array.isArray(target) ? [...(target as readonly SelectTarget[])] : [target as SelectTarget];
    this.found = false;
    this.root.visible = false;
  }

  /**
   * Hide the outline while the core draws a capture or a picture of the frame index, so a picture of a time is the same
   * with and without a selection (the keys of the strip and the index do not hold the selection).
   */
  suppress(on: boolean): void {
    this.suppressed = on;
    this.root.visible = this.found && !on;
  }

  /** Draw the boxes of the targets in this frame: one box for each selected item that the scene shows. */
  update(input: OutlineInput): void {
    const boxes = this.targets
      .map((target) => targetCorners(target, input))
      .filter((corners): corners is Vector3[] => corners !== null);
    this.found = boxes.length > 0;
    this.root.visible = this.found && !this.suppressed;
    if (!this.found) return;
    const positions = new Float32Array(boxes.length * EDGES.length * 3);
    let index = 0;
    for (const corners of boxes) {
      for (const corner of EDGES) {
        const at = corners[corner];
        if (at !== undefined) positions.set([at.x, at.y, at.z], index * 3);
        index += 1;
      }
    }
    this.root.geometry.setAttribute("position", new BufferAttribute(positions, 3));
  }

  dispose(): void {
    this.root.geometry.dispose();
    (this.root.material as LineBasicMaterial).dispose();
  }
}

/** The 8 corners of a box (bit 0: x, bit 1: y, bit 2: z), each through a matrix. */
function boxCorners(min: Vec3, max: Vec3, matrix: Matrix4 | null): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i < 8; i += 1) {
    const at = new Vector3(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]);
    out.push(matrix === null ? at : at.applyMatrix4(matrix));
  }
  return out;
}

/** The corners of the box of a target in the room, or null when the scene does not show it. */
export function targetCorners(target: SelectTarget, input: OutlineInput): Vector3[] | null {
  if (target.kind === "member") {
    const joints = input.members.get(target.id);
    if (joints === undefined) return null;
    const box = new Box3();
    for (const at of Object.values(joints)) box.expandByPoint(new Vector3(at[0], at[1], at[2]));
    if (box.isEmpty()) return null;
    box.expandByScalar(MEMBER_MARGIN);
    return boxCorners([box.min.x, box.min.y, box.min.z], [box.max.x, box.max.y, box.max.z], null);
  }
  if (target.kind === "prop" || target.kind === "scratch") {
    // A scratch prop has its place in its group (scratch.ts).
    const scratch =
      target.kind === "scratch" ? input.scene.getObjectByName(`${SCRATCH_PREFIX}${target.id}`) : undefined;
    const place = scratch === undefined ? input.places[target.id] : scratchPlaceOf(scratch);
    const object = scratch ?? propObject(input.scene, target.id);
    if (place === undefined || object === null) return null;
    const local = placeBox(object, place);
    const matrix = new Matrix4().makeRotationY(place.yaw).setPosition(place.at[0], place.at[1], place.at[2]);
    return boxCorners(local.min, local.max, matrix);
  }
  // The object of a plugin kind (pickKinds.ts), else the node with the name of the ID.
  const named = firstAnswer((classifier) => classifier.outlineObject?.(input.scene, target));
  const object = named !== undefined ? named : input.scene.getObjectByName(target.id);
  if (object?.visible !== true) return null;
  const box = new Box3().setFromObject(object);
  if (box.isEmpty()) return null;
  return boxCorners([box.min.x, box.min.y, box.min.z], [box.max.x, box.max.y, box.max.z], null);
}
