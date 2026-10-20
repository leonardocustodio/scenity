// SPDX-License-Identifier: Apache-2.0
/**
 * The canonical humanoid of the rig profiles. The bone names are the humanoid bone names of VRM 1.0, so a
 * reader who knows one standard knows the list. A rig profile maps each canonical bone to the bone names of one
 * skeleton family (profiles.ts); the retarget moves a clip from one skeleton to another through the canonical bones
 * (retarget.ts).
 *
 * Each canonical bone has a parent and the children that give its direction (the line from its head to the head of
 * the first child that both skeletons have). The retarget uses the directions to align two rest poses.
 */

type Torso = "hips" | "spine" | "chest" | "upperChest" | "neck" | "head";
type Limb = "Shoulder" | "UpperArm" | "LowerArm" | "Hand" | "UpperLeg" | "LowerLeg" | "Foot" | "Toes";
const FINGER = ["Thumb", "Index", "Middle", "Ring", "Little"] as const;
/** The three segments of a finger. The thumb has a metacarpal segment in place of the intermediate one. */
const SEGMENTS = ["Proximal", "Intermediate", "Distal"] as const;
const THUMB = ["Metacarpal", "Proximal", "Distal"] as const;

type Side = "left" | "right";
type FingerBone =
  | `${Side}Thumb${(typeof THUMB)[number]}`
  | `${Side}${Exclude<(typeof FINGER)[number], "Thumb">}${(typeof SEGMENTS)[number]}`;

/** A canonical humanoid bone. */
export type HumanBone = Torso | `${Side}${Limb}` | FingerBone;

export interface HumanBoneSpec {
  readonly name: HumanBone;
  /** The canonical parent, or null for the hips. A missing parent gives its place to the next one up. */
  readonly parent: HumanBone | null;
  /** The children that give the direction of the bone, in order of choice. Empty for an end bone. */
  readonly toward: readonly HumanBone[];
}

function fingerBones(side: Side): HumanBoneSpec[] {
  const bones: HumanBoneSpec[] = [];
  for (const finger of FINGER) {
    const parts = finger === "Thumb" ? THUMB : SEGMENTS;
    const names = parts.map((part) => `${side}${finger}${part}` as HumanBone);
    names.forEach((name, i) => {
      const next = names[i + 1];
      bones.push({ name, parent: names[i - 1] ?? `${side}Hand`, toward: next === undefined ? [] : [next] });
    });
  }
  return bones;
}

function sideBones(side: Side): HumanBoneSpec[] {
  const bone = (part: Limb): HumanBone => `${side}${part}`;
  return [
    { name: bone("Shoulder"), parent: "upperChest", toward: [bone("UpperArm")] },
    { name: bone("UpperArm"), parent: bone("Shoulder"), toward: [bone("LowerArm")] },
    { name: bone("LowerArm"), parent: bone("UpperArm"), toward: [bone("Hand")] },
    { name: bone("Hand"), parent: bone("LowerArm"), toward: [`${side}MiddleProximal`] },
    { name: bone("UpperLeg"), parent: "hips", toward: [bone("LowerLeg")] },
    { name: bone("LowerLeg"), parent: bone("UpperLeg"), toward: [bone("Foot")] },
    { name: bone("Foot"), parent: bone("LowerLeg"), toward: [bone("Toes")] },
    { name: bone("Toes"), parent: bone("Foot"), toward: [] },
    ...fingerBones(side),
  ];
}

/** The canonical bones in parent-first order: 6 of the torso and 23 on each side (limbs and fingers). */
export const HUMAN_BONES: readonly HumanBoneSpec[] = [
  { name: "hips", parent: null, toward: ["spine"] },
  { name: "spine", parent: "hips", toward: ["chest", "upperChest", "neck"] },
  { name: "chest", parent: "spine", toward: ["upperChest", "neck"] },
  { name: "upperChest", parent: "chest", toward: ["neck"] },
  { name: "neck", parent: "upperChest", toward: ["head"] },
  { name: "head", parent: "neck", toward: [] },
  ...sideBones("left"),
  ...sideBones("right"),
];

/** The spec of each canonical bone by name. */
export const HUMAN_BONE_SPECS: ReadonlyMap<HumanBone, HumanBoneSpec> = new Map(
  HUMAN_BONES.map((bone) => [bone.name, bone]),
);

/** The bones that a humanoid skeleton must have (the required bones of VRM 1.0). */
export const REQUIRED_HUMAN_BONES: readonly HumanBone[] = [
  "hips",
  "spine",
  "head",
  ...(["left", "right"] as const).flatMap((side) =>
    (["UpperArm", "LowerArm", "Hand", "UpperLeg", "LowerLeg", "Foot"] as const).map(
      (part): HumanBone => `${side}${part}`,
    ),
  ),
];
