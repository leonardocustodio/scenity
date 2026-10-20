// SPDX-License-Identifier: Apache-2.0
/**
 * The reference skeleton of the rig spec: a 1.75 m person in the A-pose of the spec, built in code from rig.ts. The
 * tests of the rig driver, the IK and the retarget use it. It has no mesh.
 *
 * As in a Blender export, each bone has its own rest rotation: the local y axis of a bone points to its main
 * child bone. Thus the tests do not depend on rest rotations of identity.
 */
import { Bone, Group, Quaternion, Vector3 } from "three";
import { HUMANOID_BONES } from "./rig";

const Y = new Vector3(0, 1, 0);

/** The joint places of the reference person in metres (y up, the face to +z, the left side at +x). */
function joints(): Map<string, Vector3> {
  const at = new Map<string, Vector3>();
  const set = (name: string, x: number, y: number, z: number): void => {
    at.set(name, new Vector3(x, y, z));
  };
  const put = (name: string, point: Vector3): void => {
    at.set(name, point);
  };
  set("root", 0, 0, 0);
  set("pelvis", 0, 0.95, 0);
  set("spine_01", 0, 1.02, -0.01);
  set("spine_02", 0, 1.16, -0.015);
  set("spine_03", 0, 1.3, -0.01);
  set("neck_01", 0, 1.47, -0.01);
  set("head", 0, 1.56, 0);
  // A-pose: the upper arm and the forearm 45° down from the horizontal.
  const down = new Vector3(Math.SQRT1_2, -Math.SQRT1_2, 0);
  for (const [s, x] of [
    ["l", 1],
    ["r", -1],
  ] as const) {
    const side = new Vector3(down.x * x, down.y, 0);
    const shoulder = new Vector3(0.17 * x, 1.42, -0.01);
    const elbow = shoulder.clone().addScaledVector(side, 0.29);
    const wrist = elbow.clone().addScaledVector(side, 0.26);
    set(`clavicle_${s}`, 0.025 * x, 1.4, 0.02);
    put(`upperarm_${s}`, shoulder.clone());
    put(`upperarm_twist_01_${s}`, shoulder.clone().addScaledVector(side, 0.145));
    put(`lowerarm_${s}`, elbow.clone());
    put(`lowerarm_twist_01_${s}`, elbow.clone().addScaledVector(side, 0.13));
    put(`hand_${s}`, wrist.clone());
    const fingers: readonly (readonly [string, number])[] = [
      ["index", 0.025],
      ["middle", 0.005],
      ["ring", -0.015],
      ["pinky", -0.032],
    ];
    for (const [finger, z] of fingers) {
      const base = wrist
        .clone()
        .addScaledVector(side, 0.09)
        .add(new Vector3(0, 0, z));
      for (const n of ["1", "2", "3"]) {
        put(`${finger}_0${n}_${s}`, base.clone().addScaledVector(side, 0.035 * (Number(n) - 1)));
      }
    }
    const thumb = wrist
      .clone()
      .addScaledVector(side, 0.025)
      .add(new Vector3(0, -0.01, 0.03));
    for (const n of ["1", "2", "3"]) {
      const step = Number(n);
      put(`thumb_0${n}_${s}`, thumb.clone().add(new Vector3(0.012 * x * step, -0.012 * step, 0.018 * step)));
    }
    set(`thigh_${s}`, 0.09 * x, 0.91, 0);
    set(`thigh_twist_01_${s}`, 0.09 * x, 0.7, 0.005);
    set(`calf_${s}`, 0.09 * x, 0.49, 0.01);
    set(`foot_${s}`, 0.09 * x, 0.08, -0.02);
    set(`ball_${s}`, 0.09 * x, 0.015, 0.12);
  }
  return at;
}

/** The child that the local y axis of a bone points to; null keeps the direction of the parent. */
const MAIN_CHILD: Readonly<Record<string, string | null>> = {
  root: "pelvis",
  pelvis: "spine_01",
  spine_01: "spine_02",
  spine_02: "spine_03",
  spine_03: "neck_01",
  neck_01: "head",
  head: null,
};

function mainChild(name: string): string | null {
  if (name in MAIN_CHILD) return MAIN_CHILD[name] ?? null;
  const s = name.slice(-1);
  const stem = name.slice(0, -2);
  const next: Readonly<Record<string, string>> = {
    clavicle: `upperarm_${s}`,
    upperarm: `lowerarm_${s}`,
    upperarm_twist_01: `lowerarm_${s}`,
    lowerarm: `hand_${s}`,
    lowerarm_twist_01: `hand_${s}`,
    hand: `middle_01_${s}`,
    thigh: `calf_${s}`,
    thigh_twist_01: `calf_${s}`,
    calf: `foot_${s}`,
    foot: `ball_${s}`,
  };
  const found = next[stem];
  if (found !== undefined) return found;
  const finger = /^(thumb|index|middle|ring|pinky)_0([12])$/.exec(stem);
  if (finger !== null) return `${finger[1] ?? ""}_0${String(Number(finger[2]) + 1)}_${s}`;
  return null;
}

export interface ReferenceRig {
  /** The model: a group with the root bone, as the glTF scene of a character. */
  readonly model: Group;
  readonly bones: ReadonlyMap<string, Bone>;
}

/** Build the reference skeleton with every bone of the spec (the optional bones too). */
export function referenceRig(): ReferenceRig {
  const at = joints();
  const world = new Map<string, Quaternion>();
  const bones = new Map<string, Bone>();
  const model = new Group();
  model.name = "reference_rig";
  for (const spec of HUMANOID_BONES) {
    const position = at.get(spec.name);
    if (position === undefined) throw new Error(`No reference place for ${spec.name}`);
    const parentWorld = spec.parent === null ? new Quaternion() : (world.get(spec.parent) ?? new Quaternion());
    const child = mainChild(spec.name);
    const target = child === null ? undefined : at.get(child);
    const rotation =
      target === undefined
        ? parentWorld.clone()
        : new Quaternion().setFromUnitVectors(Y, target.clone().sub(position).normalize());
    world.set(spec.name, rotation);
    const bone = new Bone();
    bone.name = spec.name;
    const parentPosition = spec.parent === null ? new Vector3() : (at.get(spec.parent) ?? new Vector3());
    const parentInverse = parentWorld.clone().invert();
    bone.position.copy(position.clone().sub(parentPosition).applyQuaternion(parentInverse));
    bone.quaternion.copy(parentInverse.multiply(rotation));
    const parent = spec.parent === null ? model : bones.get(spec.parent);
    parent?.add(bone);
    bones.set(spec.name, bone);
  }
  model.updateMatrixWorld(true);
  return { model, bones };
}
