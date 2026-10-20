// SPDX-License-Identifier: Apache-2.0
/**
 * The rig profiles of the humanoid: data that map the canonical bones (humanoid.ts) to the bone names of one
 * skeleton family. A bone has a list of candidate names. The resolution (resolve.ts) reads the bones in the order
 * of the map, and a bone takes the first candidate that the skeleton has and that no bone before it took.
 *
 * - `ue5`: the UE5 mannequin (spine_01 to spine_05), and the shorter UE4 spine (spine_01 to spine_03). The order
 *   "upperChest before chest" gives spine_05 and spine_03 on a UE5 skeleton, spine_03 and spine_02 on a short spine.
 * - `rigify`: a rig that Rigify of Blender generates (the DEF-* deform bones), its ORG-* bones, or the metarig.
 * - `vrm`: the bone names of VRoid Studio (J_Bip_*), or the canonical names themselves.
 * - `mixamo`: the Mixamo skeleton with or without the `mixamorig:` prefix. Many motion capture files (BVH and FBX)
 *   use the same names without the prefix.
 */
import type { HumanBone } from "./humanoid";

/** A rig profile: the candidate names of each canonical bone, in the order of resolution. */
export interface RigProfile {
  /** The ID that an asset record names (`rig`). */
  readonly id: string;
  readonly name: string;
  readonly bones: Readonly<Partial<Record<HumanBone, readonly string[]>>>;
}

/** The asset record value of a skeleton with no profile: it plays its own clips only. */
export const NO_RIG_PROFILE = "none";

type Side = "left" | "right";
type Names = Partial<Record<HumanBone, readonly string[]>>;

const FINGER_PARTS = [
  ["ThumbMetacarpal", "ThumbProximal", "ThumbDistal"],
  ["IndexProximal", "IndexIntermediate", "IndexDistal"],
  ["MiddleProximal", "MiddleIntermediate", "MiddleDistal"],
  ["RingProximal", "RingIntermediate", "RingDistal"],
  ["LittleProximal", "LittleIntermediate", "LittleDistal"],
] as const;

/** The names of the bones of one side: `limb` has the names of the 8 limb parts, `finger` the names of a segment. */
function side(
  s: Side,
  limb: readonly string[],
  finger: (fingerIndex: number, segment: number) => readonly string[],
): Names {
  const names: Record<string, readonly string[]> = {};
  const parts = ["Shoulder", "UpperArm", "LowerArm", "Hand", "UpperLeg", "LowerLeg", "Foot", "Toes"];
  parts.forEach((part, i) => {
    names[`${s}${part}`] = [limb[i] ?? ""];
  });
  FINGER_PARTS.forEach((segments, f) => {
    segments.forEach((part, n) => {
      names[`${s}${part}`] = finger(f, n);
    });
  });
  return names;
}

/** The same names with each prefix of `prefixes` (the first prefix first). */
function prefixed(names: Names, prefixes: readonly string[]): Names {
  const out: Record<string, readonly string[]> = {};
  for (const [bone, list] of Object.entries(names)) out[bone] = prefixes.flatMap((p) => list.map((n) => p + n));
  return out;
}

const UE5_FINGERS = ["thumb", "index", "middle", "ring", "pinky"] as const;

function ue5Side(s: "l" | "r", sideName: Side): Names {
  const limb = ["clavicle", "upperarm", "lowerarm", "hand", "thigh", "calf", "foot", "ball"].map((n) => `${n}_${s}`);
  return side(sideName, limb, (f, n) => [`${UE5_FINGERS[f] ?? ""}_0${String(n + 1)}_${s}`]);
}

export const UE5_PROFILE: RigProfile = {
  id: "ue5",
  name: "Unreal Engine 5 mannequin",
  bones: {
    hips: ["pelvis"],
    spine: ["spine_01"],
    upperChest: ["spine_05", "spine_03"],
    chest: ["spine_03", "spine_02"],
    neck: ["neck_01"],
    head: ["head"],
    ...ue5Side("l", "left"),
    ...ue5Side("r", "right"),
  },
};

const RIGIFY_FINGERS = ["thumb", "f_index", "f_middle", "f_ring", "f_pinky"] as const;

function rigifySide(s: "L" | "R", sideName: Side): Names {
  const limb = ["shoulder", "upper_arm", "forearm", "hand", "thigh", "shin", "foot", "toe"].map((n) => `${n}.${s}`);
  return side(sideName, limb, (f, n) => [`${RIGIFY_FINGERS[f] ?? ""}.0${String(n + 1)}.${s}`]);
}

export const RIGIFY_PROFILE: RigProfile = {
  id: "rigify",
  name: "Rigify (Blender)",
  bones: prefixed(
    {
      hips: ["spine"],
      spine: ["spine.001"],
      chest: ["spine.002"],
      upperChest: ["spine.003"],
      neck: ["spine.004"],
      head: ["spine.006", "spine.005"],
      ...rigifySide("L", "left"),
      ...rigifySide("R", "right"),
    },
    ["DEF-", "ORG-", ""],
  ),
};

const VROID_FINGERS = ["Thumb", "Index", "Middle", "Ring", "Little"] as const;

function vrmSide(s: "L" | "R", sideName: Side): Names {
  const parts = ["Shoulder", "UpperArm", "LowerArm", "Hand", "UpperLeg", "LowerLeg", "Foot", "ToeBase"];
  const names = side(
    sideName,
    parts.map((n) => `J_Bip_${s}_${n}`),
    (f, n) => [`J_Bip_${s}_${VROID_FINGERS[f] ?? ""}${String(n + 1)}`],
  );
  // The canonical name is the second candidate of each bone.
  const out: Record<string, readonly string[]> = {};
  for (const [bone, list] of Object.entries(names)) out[bone] = [...list, bone];
  return out;
}

export const VRM_PROFILE: RigProfile = {
  id: "vrm",
  name: "VRM (VRoid Studio names or VRM humanoid names)",
  bones: {
    hips: ["J_Bip_C_Hips", "hips"],
    spine: ["J_Bip_C_Spine", "spine"],
    chest: ["J_Bip_C_Chest", "chest"],
    upperChest: ["J_Bip_C_UpperChest", "upperChest"],
    neck: ["J_Bip_C_Neck", "neck"],
    head: ["J_Bip_C_Head", "head"],
    ...vrmSide("L", "left"),
    ...vrmSide("R", "right"),
  },
};

const MIXAMO_FINGERS = ["Thumb", "Index", "Middle", "Ring", "Pinky"] as const;

function mixamoSide(s: "Left" | "Right", sideName: Side): Names {
  const parts = ["Shoulder", "Arm", "ForeArm", "Hand", "UpLeg", "Leg", "Foot", "ToeBase"];
  return side(
    sideName,
    parts.map((n) => `${s}${n}`),
    (f, n) => [`${s}Hand${MIXAMO_FINGERS[f] ?? ""}${String(n + 1)}`],
  );
}

export const MIXAMO_PROFILE: RigProfile = {
  id: "mixamo",
  name: "Mixamo and common motion capture names",
  bones: prefixed(
    {
      hips: ["Hips"],
      spine: ["Spine"],
      chest: ["Spine1"],
      upperChest: ["Spine2"],
      neck: ["Neck"],
      head: ["Head"],
      ...mixamoSide("Left", "left"),
      ...mixamoSide("Right", "right"),
    },
    ["mixamorig:", ""],
  ),
};

/** The built-in profiles, in the order of the detection tie break. */
export const RIG_PROFILES: readonly RigProfile[] = [UE5_PROFILE, RIGIFY_PROFILE, VRM_PROFILE, MIXAMO_PROFILE];
