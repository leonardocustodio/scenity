// SPDX-License-Identifier: Apache-2.0
/**
 * The rig driver: it copies the pose of a neutral body (body.ts) to a skeleton of the rig spec (rig.ts). The skeleton
 * can have any rest pose (the spec asks for an A-pose); the driver measures it once.
 *
 * Terms. All rotations are in the frame of the model (the glTF scene under the root of the member).
 * - W: the rest rotation of a bone in the model frame. R: the rest rotation of a bone in its parent.
 * - G: the rotation of the matching neutral joint in the frame of the body root.
 * - B: the new rotation of a bone in the model frame. L = B(parent)⁻¹ · B: the new local rotation.
 *
 * Rules.
 * - Trunk bones (pelvis, spine_01, spine_03, neck_01, head): B = G · W. The bone turns as the neutral joint turns
 *   (spine_03 is the upper back, the chest joint of the body; spine_02 keeps its rest rotation in spine_01).
 * - Limb bones (upperarm, lowerarm, thigh, calf): B = G · C⁻¹ · W. C turns the neutral rest direction (down)
 *   onto the rest direction of the bone (to its child bone). Thus an A-pose or a T-pose arm points where the
 *   neutral arm points, and the hand bone reaches the IK target of the neutral hand.
 * - Hand bones of a turned hand (Body.turnedHands: a target with `fingers`): B = G · H⁻¹ · W. H turns the neutral
 *   hand frame (the fingers down, the thumb forward) onto the rest frame of the hand (to middle_01, and from
 *   pinky_01 to index_01 for the thumb side), so the palm turns as the neutral hand turns. Else the hand keeps its
 *   rest rotation in the forearm.
 * - Finger bones of a hand that closes (Body.grips, a grip g): B = C · B(parent) · R. C turns by g times the angle
 *   of the joint (FINGER_CURL) about the curl axis of the hand: the axis that bends the fingers to the palm (the
 *   thumb bends to the palm about its own axis). The axes are measured at rest and turn with the hand bone.
 * - All other bones keep their rest rotation in the parent: B = B(parent) · R.
 * - The pelvis bone goes to the place of the neutral pelvis (crouch, bob, lean). The other bones keep their
 *   rest offsets. Thus every neutral joint and its bone have the same place.
 *
 * The driver sizes the body from the rest pose (the lengths of the arms and the legs, the offsets of the joints),
 * so the neutral IK uses the real lengths. The neutral legs are straight; when the rest legs are not straight,
 * the pelvis rises by the difference, so the feet stay on the floor.
 */
import { Matrix4, Quaternion, Vector3, type Bone, type Object3D } from "three";
import type { Body, BodySize } from "./body";
import type { Vec3 } from "./math";
import type { Finger } from "./place";
import { HUMANOID_BONES } from "./rig";

const DOWN = new Vector3(0, -1, 0);

type Joint = (body: Body) => Object3D;

/** The neutral joint of each driven bone. */
const TRUNK: Readonly<Record<string, Joint>> = {
  pelvis: (body) => body.pelvis,
  spine_01: (body) => body.spine,
  spine_03: (body) => body.chest,
  neck_01: (body) => body.neck,
  head: (body) => body.head,
};

const LIMBS: Readonly<Record<string, { readonly joint: Joint; readonly child: string }>> = {
  upperarm_l: { joint: (body) => body.arms[0].upper, child: "lowerarm_l" },
  lowerarm_l: { joint: (body) => body.arms[0].elbow, child: "hand_l" },
  upperarm_r: { joint: (body) => body.arms[1].upper, child: "lowerarm_r" },
  lowerarm_r: { joint: (body) => body.arms[1].elbow, child: "hand_r" },
  thigh_l: { joint: (body) => body.legs[0].hip, child: "calf_l" },
  calf_l: { joint: (body) => body.legs[0].knee, child: "foot_l" },
  thigh_r: { joint: (body) => body.legs[1].hip, child: "calf_r" },
  calf_r: { joint: (body) => body.legs[1].knee, child: "foot_r" },
};

/** The hand bones: the neutral arm and the bones that give the rest frame of the hand. */
const HANDS: Readonly<
  Record<string, { readonly arm: 0 | 1; readonly middle: string; readonly index: string; readonly pinky: string }>
> = {
  hand_l: { arm: 0, middle: "middle_01_l", index: "index_01_l", pinky: "pinky_01_l" },
  hand_r: { arm: 1, middle: "middle_01_r", index: "index_01_r", pinky: "pinky_01_r" },
};

/**
 * The bend of each finger joint at a full grip (radians): the knuckle (_01), the middle joint (_02) and the end
 * joint (_03). The thumb bends less: it closes on the side of the hand.
 */
const FINGER_CURL: Readonly<Record<string, readonly [number, number, number]>> = {
  thumb: [0.15, 0.4, 0.45],
  index: [0.85, 1.15, 0.75],
  middle: [0.9, 1.2, 0.8],
  ring: [0.95, 1.25, 0.8],
  pinky: [1.0, 1.25, 0.8],
};

/**
 * The feet: the bone turns with the ankle of the body (Body legs). At rest the ankle has no turn in the frame of the
 * root, so the bone keeps its rest turn, as a bone of the trunk.
 */
const FEET: Readonly<Record<string, Joint>> = {
  foot_l: (body) => body.legs[0].ankle,
  foot_r: (body) => body.legs[1].ankle,
};

/** The bones that the driver turns (the others keep their rest rotation in the parent). */
export const DRIVEN_BONES: readonly string[] = [...Object.keys(TRUNK), ...Object.keys(LIMBS), ...Object.keys(FEET)];

/** The bones that a body needs; a skeleton without one of them cannot take a pose. */
const NEEDED = [
  "pelvis",
  "spine_01",
  "spine_03",
  "neck_01",
  "head",
  "upperarm_l",
  "lowerarm_l",
  "hand_l",
  "upperarm_r",
  "lowerarm_r",
  "hand_r",
  "thigh_l",
  "calf_l",
  "foot_l",
  "thigh_r",
  "calf_r",
  "foot_r",
] as const;

interface DrivenBone {
  readonly name: string;
  readonly bone: Object3D;
  /** The index of the parent in the list of driven bones, or −1 when the parent is not a spec bone. */
  readonly parent: number;
  /** The rest rotation in the parent. */
  readonly rest: Quaternion;
  /** For a bone without a spec parent: the fixed rotation of its parent in the model frame. */
  readonly parentRest: Quaternion;
  /** Trunk: W. Limb: C⁻¹ · W. Other bones: unused. */
  readonly offset: Quaternion;
  readonly joint: Joint | null;
  /** A hand bone: its arm and H⁻¹ · W (driven only while the body turns that hand). */
  readonly hand: { readonly arm: 0 | 1; readonly offset: Quaternion } | null;
  /** A finger bone: its arm, the curl axis in the model frame at rest and the bend at a full grip. */
  readonly curl: {
    readonly arm: 0 | 1;
    readonly finger: Finger;
    readonly axis: Vector3;
    readonly angle: number;
  } | null;
}

/** The rest of a hand bone for the curl of its fingers. */
interface HandRest {
  /** The index of the hand bone in the list of driven bones. */
  readonly index: number;
  /** W⁻¹ of the hand bone. */
  readonly inverse: Quaternion;
  /** The curl axis of the four fingers and of the thumb, in the model frame at rest. */
  readonly fingers: Vector3;
  readonly thumb: Vector3;
}

/** Find the bones of the spec in a model: the first object with the name that is a bone. */
export function findBones(model: Object3D): Map<string, Object3D> {
  const found = new Map<string, Object3D>();
  model.traverse((child) => {
    if ((child as Partial<Bone>).isBone === true && !found.has(child.name)) found.set(child.name, child);
  });
  return found;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function vec(v: Vector3): Vec3 {
  return [round(v.x), round(v.y), round(v.z)];
}

/** The rest frame of a bone in the model frame. */
interface RestFrame {
  readonly position: Vector3;
  readonly rotation: Quaternion;
}

/** The rest pose of a model: its inverse world matrix and the rest frame of each bone in the model frame. */
interface RestPose {
  readonly modelInverse: Matrix4;
  readonly frames: ReadonlyMap<string, RestFrame>;
  /** The rest place of a bone. Throws when the model has no such bone. */
  readonly at: (name: string) => Vector3;
}

/** Measure the rest pose of the bones of a model (the model must be at its rest pose). */
function restPose(model: Object3D, found: ReadonlyMap<string, Object3D>): RestPose {
  model.updateMatrixWorld(true);
  const modelInverse = model.matrixWorld.clone().invert();
  const frames = new Map<string, RestFrame>();
  const scale = new Vector3();
  for (const [name, bone] of found) {
    const matrix = modelInverse.clone().multiply(bone.matrixWorld);
    const position = new Vector3();
    const rotation = new Quaternion();
    matrix.decompose(position, rotation, scale);
    frames.set(name, { position, rotation });
  }
  const at = (name: string): Vector3 => {
    const entry = frames.get(name);
    if (entry === undefined) throw new Error(`The character has no bone "${name}".`);
    return entry.position;
  };
  return { modelInverse, frames, at };
}

/** The fixed rotation of the parent of a bone without a spec parent (an armature node, or a bone outside the spec). */
function parentRestOf(bone: Object3D, parent: number, modelInverse: Matrix4): Quaternion {
  const parentRest = new Quaternion();
  if (parent === -1 && bone.parent !== null) {
    // The fixed parent keeps its rest rotation.
    const parentMatrix = modelInverse.clone().multiply(bone.parent.matrixWorld);
    parentMatrix.decompose(new Vector3(), parentRest, new Vector3());
  }
  return parentRest;
}

/**
 * The hand data of a hand bone: H⁻¹ · W for the turned hand, and the rest of the hand for the curl of its fingers.
 * Null when the model has no middle, index or pinky bone of the hand.
 */
function handFrame(
  spec: { readonly arm: 0 | 1; readonly middle: string; readonly index: string; readonly pinky: string },
  rest: RestFrame,
  pose: RestPose,
): { readonly hand: NonNullable<DrivenBone["hand"]>; readonly rest: Omit<HandRest, "index"> } | null {
  if (![spec.middle, spec.index, spec.pinky].every((name) => pose.frames.has(name))) return null;
  const fingers = pose.at(spec.middle).clone().sub(rest.position).normalize();
  const thumbSide = pose.at(spec.index).clone().sub(pose.at(spec.pinky));
  thumbSide.addScaledVector(fingers, -thumbSide.dot(fingers)).normalize();
  const restFrame = new Matrix4().makeBasis(fingers, thumbSide, fingers.clone().cross(thumbSide));
  const forward = new Vector3(0, 0, 1);
  const neutralFrame = new Matrix4().makeBasis(DOWN, forward, DOWN.clone().cross(forward));
  const turn = new Quaternion().setFromRotationMatrix(restFrame.multiply(neutralFrame.invert()));
  const hand = { arm: spec.arm, offset: turn.invert().multiply(rest.rotation) };
  // The palm faces the side of the thumb turned toward the fingers: right hand t × f, left hand f × t. The
  // curl axis a = f × n turns the fingers toward the palm.
  const palm = spec.arm === 1 ? thumbSide.clone().cross(fingers) : fingers.clone().cross(thumbSide);
  const side = spec.arm === 1 ? "r" : "l";
  const thumbFrom = pose.frames.get(`thumb_01_${side}`)?.position;
  const thumbTo = pose.frames.get(`thumb_03_${side}`)?.position;
  const thumbDirection =
    thumbFrom !== undefined && thumbTo !== undefined ? thumbTo.clone().sub(thumbFrom).normalize() : thumbSide;
  return {
    hand,
    rest: {
      inverse: rest.rotation.clone().invert(),
      fingers: fingers.clone().cross(palm).normalize(),
      thumb: thumbDirection.clone().cross(palm).normalize(),
    },
  };
}

/** The curl of a finger bone from the rest of its hand, or null for a bone that is not a finger of a known hand. */
function curlOf(name: string, hands: readonly [HandRest | null, HandRest | null]): DrivenBone["curl"] {
  const fingerMatch = /^(thumb|index|middle|ring|pinky)_0([123])_([lr])$/.exec(name);
  const fingerHand = fingerMatch === null ? null : hands[fingerMatch[3] === "r" ? 1 : 0];
  return fingerMatch === null || fingerHand === null
    ? null
    : {
        arm: fingerMatch[3] === "r" ? 1 : 0,
        finger: (fingerMatch[1] ?? "index") as Finger,
        axis: fingerMatch[1] === "thumb" ? fingerHand.thumb : fingerHand.fingers,
        angle: FINGER_CURL[fingerMatch[1] ?? ""]?.[Number(fingerMatch[2]) - 1] ?? 0,
      };
}

/** The neutral joint of a driven bone and its offset (trunk and feet: W; limbs: C⁻¹ · W; other bones: none). */
function jointOf(name: string, rest: RestFrame, pose: RestPose): { joint: Joint | null; offset: Quaternion } {
  const trunk = TRUNK[name] ?? FEET[name];
  if (trunk !== undefined) return { joint: trunk, offset: rest.rotation.clone() };
  const limb = LIMBS[name];
  if (limb === undefined) return { joint: null, offset: new Quaternion() };
  const direction = pose.at(limb.child).clone().sub(rest.position).normalize();
  const turn = new Quaternion().setFromUnitVectors(DOWN, direction);
  return { joint: limb.joint, offset: turn.invert().multiply(rest.rotation) };
}

/** The body sizes from the rest pose: the lengths of the limbs and the offsets of the joints. */
function bodySize(at: (name: string) => Vector3): BodySize {
  const half = (a: Vector3, b: Vector3): Vector3 => a.clone().add(b).multiplyScalar(0.5);
  const length = (from: string, to: string): number => at(to).distanceTo(at(from));
  const pelvisAt = at("pelvis");
  const spineAt = at("spine_01");
  const chestAt = at("spine_03");
  const neckAt = at("neck_01");
  const upperLength = (length("upperarm_l", "lowerarm_l") + length("upperarm_r", "lowerarm_r")) / 2;
  const lowerLength = (length("lowerarm_l", "hand_l") + length("lowerarm_r", "hand_r")) / 2;
  const thighLength = (length("thigh_l", "calf_l") + length("thigh_r", "calf_r")) / 2;
  const shinLength = (length("calf_l", "foot_l") + length("calf_r", "foot_r")) / 2;
  const hipY = half(at("thigh_l"), at("thigh_r")).y;
  const ankleY = half(at("foot_l"), at("foot_r")).y;
  const lift = Math.max(0, thighLength + shinLength - (hipY - ankleY));
  return {
    scale: round((thighLength + shinLength) / 0.9),
    hipHeight: round(pelvisAt.y + lift),
    spine: vec(spineAt.clone().sub(pelvisAt)),
    chest: vec(chestAt.clone().sub(spineAt)),
    neck: vec(neckAt.clone().sub(chestAt)),
    head: vec(at("head").clone().sub(neckAt)),
    shoulders: [vec(at("upperarm_l").clone().sub(chestAt)), vec(at("upperarm_r").clone().sub(chestAt))],
    hips: [vec(at("thigh_l").clone().sub(pelvisAt)), vec(at("thigh_r").clone().sub(pelvisAt))],
    upperLength: round(upperLength),
    lowerLength: round(lowerLength),
    thighLength: round(thighLength),
    shinLength: round(shinLength),
  };
}

export class RigDriver {
  readonly size: BodySize;
  private readonly bones: DrivenBone[] = [];
  private readonly pelvis: Object3D;
  /** The inverse rest matrix of the parent of the pelvis bone in the model frame. */
  private readonly pelvisParentInverse = new Matrix4();
  private readonly worlds: Quaternion[] = [];
  private readonly g = new Quaternion();
  private readonly rootInverse = new Quaternion();
  private readonly local = new Quaternion();
  private readonly target = new Vector3();
  private readonly hands: [HandRest | null, HandRest | null] = [null, null];
  /** B · W⁻¹ of each hand bone in this drive: the turn of the curl axes. */
  private readonly handTurns: [Quaternion, Quaternion] = [new Quaternion(), new Quaternion()];
  private readonly axis = new Vector3();
  private readonly curlTurn = new Quaternion();

  /**
   * `model` is the glTF scene of the character at its rest pose. It must be a child of the body root with an
   * identity transform when the driver runs. Throws when a needed bone is missing.
   */
  constructor(model: Object3D) {
    const found = findBones(model);
    for (const name of NEEDED) {
      if (!found.has(name)) throw new Error(`The character has no bone "${name}".`);
    }
    const pose = restPose(model, found);
    const index = new Map<string, number>();
    for (const spec of HUMANOID_BONES) {
      const bone = found.get(spec.name);
      const rest = pose.frames.get(spec.name);
      if (bone === undefined || rest === undefined) continue;
      const parent = spec.parent === null ? -1 : (index.get(spec.parent) ?? -1);
      const handSpec = HANDS[spec.name];
      const hand = handSpec === undefined ? null : handFrame(handSpec, rest, pose);
      if (handSpec !== undefined && hand !== null)
        this.hands[handSpec.arm] = { index: this.bones.length, ...hand.rest };
      const { joint, offset } = jointOf(spec.name, rest, pose);
      index.set(spec.name, this.bones.length);
      this.bones.push({
        name: spec.name,
        bone,
        parent,
        rest: bone.quaternion.clone(),
        parentRest: parentRestOf(bone, parent, pose.modelInverse),
        offset,
        joint,
        hand: hand?.hand ?? null,
        curl: curlOf(spec.name, this.hands),
      });
      this.worlds.push(new Quaternion());
    }
    const pelvis = found.get("pelvis");
    if (pelvis === undefined) throw new Error('The character has no bone "pelvis".');
    this.pelvis = pelvis;
    if (pelvis.parent !== null) {
      this.pelvisParentInverse.copy(pose.modelInverse.clone().multiply(pelvis.parent.matrixWorld)).invert();
    }
    this.size = bodySize(pose.at);
  }

  /** The names of the bones that the driver knows, in parent-first order. */
  get boneNames(): readonly string[] {
    return this.bones.map((item) => item.name);
  }

  /**
   * Set the bones from a body after `body.apply(pose)`. The model must be a child of `body.root` with an
   * identity transform.
   */
  drive(body: Body): void {
    body.root.getWorldQuaternion(this.rootInverse).invert();
    for (let index = 0; index < this.bones.length; index += 1) {
      const item = this.bones[index];
      const world = this.worlds[index];
      if (item === undefined || world === undefined) continue;
      const parentWorld = item.parent === -1 ? item.parentRest : this.worlds[item.parent];
      if (parentWorld === undefined) continue;
      // The grip of the finger (HandGoal.fingerGrips), else the grip of its hand.
      const grip =
        item.curl === null ? 0 : (body.fingerGrips[item.curl.arm]?.[item.curl.finger] ?? body.grips[item.curl.arm]);
      if (item.hand !== null && body.turnedHands[item.hand.arm]) {
        body.arms[item.hand.arm].hand.getWorldQuaternion(this.g).premultiply(this.rootInverse);
        world.copy(this.g).multiply(item.hand.offset);
      } else if (item.curl !== null && grip > 0) {
        this.axis.copy(item.curl.axis).applyQuaternion(this.handTurns[item.curl.arm]);
        this.curlTurn.setFromAxisAngle(this.axis, item.curl.angle * grip);
        world.copy(parentWorld).multiply(item.rest).premultiply(this.curlTurn);
      } else if (item.joint === null) {
        world.copy(parentWorld).multiply(item.rest);
      } else {
        item.joint(body).getWorldQuaternion(this.g).premultiply(this.rootInverse);
        world.copy(this.g).multiply(item.offset);
      }
      this.local.copy(parentWorld).invert().multiply(world);
      item.bone.quaternion.copy(this.local);
      for (const [arm, rest] of this.hands.entries()) {
        if (rest?.index === index) this.handTurns[arm as 0 | 1].copy(world).multiply(rest.inverse);
      }
    }
    // The pelvis bone goes to the neutral pelvis (in the root frame, which is the model frame).
    this.target.copy(body.pelvis.position).applyMatrix4(this.pelvisParentInverse);
    this.pelvis.position.copy(this.target);
  }
}
