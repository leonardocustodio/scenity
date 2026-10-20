// SPDX-License-Identifier: Apache-2.0
/**
 * The joints of a drawn member. A glTF character has the bones of the rig spec, which the labs core finds by name: they
 * are what the scene draws. The graybox mannequin has the neutral body of the runtime (body.ts), which the labs core
 * reads from the member. The runtime keeps no names for the labs, so the render worker stays small.
 */
import type { Object3D } from "three";
import { Vector3 } from "three";
import type { Body } from "@scenity/character/body";
import { JOINT_NAMES, type JointName, type Joints } from "./inspect";

/** The bone of the rig spec for each joint. */
const RIG_BONES: Readonly<Record<JointName, string>> = {
  pelvis: "pelvis",
  head: "head",
  shoulder_l: "upperarm_l",
  elbow_l: "lowerarm_l",
  wrist_l: "hand_l",
  shoulder_r: "upperarm_r",
  elbow_r: "lowerarm_r",
  wrist_r: "hand_r",
  hip_l: "thigh_l",
  knee_l: "calf_l",
  ankle_l: "foot_l",
  hip_r: "thigh_r",
  knee_r: "calf_r",
  ankle_r: "foot_r",
};

/** The node of a joint in a neutral body (the left arm and leg are the first). */
function bodyNode(body: Body, name: JointName): Object3D {
  const [left, right] = body.arms;
  const [legL, legR] = body.legs;
  const nodes: Record<JointName, Object3D> = {
    pelvis: body.pelvis,
    head: body.head,
    shoulder_l: left.shoulder,
    elbow_l: left.elbow,
    wrist_l: left.hand,
    shoulder_r: right.shoulder,
    elbow_r: right.elbow,
    wrist_r: right.hand,
    hip_l: legL.hip,
    knee_l: legL.knee,
    ankle_l: legL.ankle,
    hip_r: legR.hip,
    knee_r: legR.knee,
    ankle_r: legR.ankle,
  };
  return nodes[name];
}

const at = new Vector3();

/** The figure of a member: its root in the scene (the plugin gives its own figure type). */
export interface JointFigure {
  readonly root: Object3D;
}

/** The places of the joints of a member in the room after the last apply. */
export function memberJoints(person: JointFigure): Joints {
  // The graybox mannequin keeps its neutral body in the field `body` (the figure of the plugin); a TypeScript private
  // is a plain field.
  const body = (person as unknown as { readonly body?: Body }).body;
  const out: Partial<Record<JointName, readonly [number, number, number]>> = {};
  for (const name of JOINT_NAMES) {
    const node =
      person.root.getObjectByName(RIG_BONES[name]) ?? (body === undefined ? undefined : bodyNode(body, name));
    if (node === undefined) continue;
    node.getWorldPosition(at);
    out[name] = [at.x, at.y, at.z];
  }
  return out;
}
