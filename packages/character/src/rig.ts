// SPDX-License-Identifier: Apache-2.0
/**
 * The humanoid rig of the characters: the bone list, the retarget chains and the skeleton check. A plugin names its
 * skeleton, its sockets and its morphs (its rig module), so the spec has one source.
 *
 * - One humanoid skeleton for every character of a plugin.
 * - Units are metres. glTF is Y up. The character faces +Z. The origin is on the floor between the feet.
 * - The rest pose is an A-pose: the upper arms 45° down from the horizontal, the palms down, the legs straight.
 *   The renderer measures the rest pose, so a T-pose also works, but the spec asks for the A-pose.
 * - The bone names are the bone names of the UE5 mannequin where a match exists, so a Quest client can use
 *   the same clips. RETARGET_CHAINS gives the IK Rig chains of the UE5 retargeter.
 * - A vertex has at most 4 bone influences. A character has at most MAX_BONES bones.
 */

/** The bone limit of one character (the CPU cost of the skin deformation). */
export const MAX_BONES = 80;

/** The limit of bone influences on one vertex (JOINTS_0 and WEIGHTS_0 only). */
export const MAX_INFLUENCES = 4;

export interface BoneSpec {
  readonly name: string;
  readonly parent: string | null;
  /** The bone of the UE5 mannequin with the same function, or null when the UE5 skeleton has no match. */
  readonly ue5: string | null;
  /** An optional bone can be missing. A bone that is not in the spec is an error. */
  readonly optional?: true;
}

const FINGERS = ["thumb", "index", "middle", "ring", "pinky"] as const;

function side(s: "l" | "r"): BoneSpec[] {
  const bones: BoneSpec[] = [
    { name: `clavicle_${s}`, parent: "spine_03", ue5: `clavicle_${s}` },
    { name: `upperarm_${s}`, parent: `clavicle_${s}`, ue5: `upperarm_${s}` },
    { name: `upperarm_twist_01_${s}`, parent: `upperarm_${s}`, ue5: `upperarm_twist_01_${s}`, optional: true },
    { name: `lowerarm_${s}`, parent: `upperarm_${s}`, ue5: `lowerarm_${s}` },
    { name: `lowerarm_twist_01_${s}`, parent: `lowerarm_${s}`, ue5: `lowerarm_twist_01_${s}`, optional: true },
    { name: `hand_${s}`, parent: `lowerarm_${s}`, ue5: `hand_${s}` },
  ];
  for (const finger of FINGERS) {
    for (const n of ["1", "2", "3"] as const) {
      const parent = n === "1" ? `hand_${s}` : `${finger}_0${n === "2" ? "1" : "2"}_${s}`;
      bones.push({ name: `${finger}_0${n}_${s}`, parent, ue5: `${finger}_0${n}_${s}` });
    }
  }
  bones.push(
    { name: `thigh_${s}`, parent: "pelvis", ue5: `thigh_${s}` },
    { name: `thigh_twist_01_${s}`, parent: `thigh_${s}`, ue5: `thigh_twist_01_${s}`, optional: true },
    { name: `calf_${s}`, parent: `thigh_${s}`, ue5: `calf_${s}` },
    { name: `foot_${s}`, parent: `calf_${s}`, ue5: `foot_${s}` },
    { name: `ball_${s}`, parent: `foot_${s}`, ue5: `ball_${s}` },
  );
  return bones;
}

/** The bones in parent-first order: 53 required bones and 6 optional twist bones. */
export const HUMANOID_BONES: readonly BoneSpec[] = [
  { name: "root", parent: null, ue5: "root" },
  { name: "pelvis", parent: "root", ue5: "pelvis" },
  { name: "spine_01", parent: "pelvis", ue5: "spine_01" },
  { name: "spine_02", parent: "spine_01", ue5: "spine_03" },
  { name: "spine_03", parent: "spine_02", ue5: "spine_05" },
  { name: "neck_01", parent: "spine_03", ue5: "neck_01" },
  { name: "head", parent: "neck_01", ue5: "head" },
  ...side("l"),
  ...side("r"),
];

/** The chains of the UE5 IK Rig retargeter: our first and last bone, and the chain name of the UE5 mannequin. */
export const RETARGET_CHAINS: readonly { readonly chain: string; readonly start: string; readonly end: string }[] = [
  { chain: "Root", start: "root", end: "root" },
  { chain: "Spine", start: "spine_01", end: "spine_03" },
  { chain: "Neck", start: "neck_01", end: "neck_01" },
  { chain: "Head", start: "head", end: "head" },
  { chain: "LeftClavicle", start: "clavicle_l", end: "clavicle_l" },
  { chain: "LeftArm", start: "upperarm_l", end: "hand_l" },
  { chain: "RightClavicle", start: "clavicle_r", end: "clavicle_r" },
  { chain: "RightArm", start: "upperarm_r", end: "hand_r" },
  { chain: "LeftLeg", start: "thigh_l", end: "ball_l" },
  { chain: "RightLeg", start: "thigh_r", end: "ball_r" },
  ...(["l", "r"] as const).flatMap((s) =>
    FINGERS.map((finger) => ({
      chain: `${s === "l" ? "Left" : "Right"}${finger[0]?.toUpperCase() ?? ""}${finger.slice(1)}`,
      start: `${finger}_01_${s}`,
      end: `${finger}_03_${s}`,
    })),
  ),
];

/** A socket is an empty node under a bone. Props and the look target attach to sockets. There is no card socket. */
export interface SocketSpec {
  readonly name: string;
  readonly bone: string;
}

/** The bone names in a set, for a fast check. */
export const BONE_NAMES: ReadonlySet<string> = new Set(HUMANOID_BONES.map((bone) => bone.name));

/** The problems of a skeleton against the spec: missing bones, unknown bones, wrong parents, too many bones. */
export function checkSkeleton(bones: readonly { readonly name: string; readonly parent: string | null }[]): string[] {
  const problems: string[] = [];
  const found = new Map(bones.map((bone) => [bone.name, bone.parent]));
  if (bones.length > MAX_BONES) problems.push(`${String(bones.length)} bones (limit ${String(MAX_BONES)})`);
  for (const spec of HUMANOID_BONES) {
    if (!found.has(spec.name)) {
      if (spec.optional !== true) problems.push(`missing bone ${spec.name}`);
      continue;
    }
    const parent = found.get(spec.name) ?? null;
    if (parent !== spec.parent)
      problems.push(`bone ${spec.name}: parent ${parent ?? "none"}, spec ${spec.parent ?? "none"}`);
  }
  for (const bone of bones) {
    if (!BONE_NAMES.has(bone.name)) problems.push(`unknown bone ${bone.name}`);
  }
  return problems;
}
