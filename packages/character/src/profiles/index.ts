// SPDX-License-Identifier: Apache-2.0
// The rig profiles of `@scenity/character/profiles`: the canonical humanoid, the profile data and the
// resolution on a skeleton. The retarget is in `@scenity/character/retarget`.
export { HUMAN_BONES, HUMAN_BONE_SPECS, REQUIRED_HUMAN_BONES, type HumanBone, type HumanBoneSpec } from "./humanoid";
export {
  MIXAMO_PROFILE,
  NO_RIG_PROFILE,
  RIG_PROFILES,
  RIGIFY_PROFILE,
  UE5_PROFILE,
  VRM_PROFILE,
  type RigProfile,
} from "./profiles";
export {
  detectProfile,
  missingBones,
  profileById,
  profileFor,
  resolveProfile,
  sanitizeNodeName,
  type BoneMap,
  type ResolvedProfile,
} from "./resolve";
