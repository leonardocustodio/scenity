// SPDX-License-Identifier: Apache-2.0
/**
 * The resolution of a rig profile on one skeleton: the bone map from the canonical bones to the node names of
 * the skeleton, the detection of the profile from the bone names, and the choice of the profile of an asset.
 *
 * The glTF loader of three.js removes the characters `[ ] . : /` from a node name and replaces a space with `_`
 * (PropertyBinding.sanitizeNodeName). The resolution compares the names in that form, so "DEF-spine.001" finds the
 * node "DEF-spine001" and "mixamorig:Hips" finds "mixamorigHips".
 */
import { REQUIRED_HUMAN_BONES, type HumanBone } from "./humanoid";
import { NO_RIG_PROFILE, RIG_PROFILES, type RigProfile } from "./profiles";

/** The canonical bones of one skeleton: canonical bone → node name of the skeleton. */
export type BoneMap = ReadonlyMap<HumanBone, string>;

/** A profile and its bone map on one skeleton. */
export interface ResolvedProfile {
  readonly profile: RigProfile;
  readonly map: BoneMap;
}

/** A node name in the form of the glTF loader of three.js (PropertyBinding.sanitizeNodeName). */
export function sanitizeNodeName(name: string): string {
  return name.replace(/\s/g, "_").replace(/[[\].:/]/g, "");
}

/** The bone map of a profile on the node names of a skeleton (see profiles.ts for the order rule). */
export function resolveProfile(profile: RigProfile, names: Iterable<string>): BoneMap {
  const byForm = new Map<string, string>();
  for (const name of names) {
    const form = sanitizeNodeName(name);
    if (!byForm.has(form)) byForm.set(form, name);
  }
  const map = new Map<HumanBone, string>();
  const taken = new Set<string>();
  for (const [bone, candidates] of Object.entries(profile.bones) as [HumanBone, readonly string[]][]) {
    for (const candidate of candidates) {
      const name = byForm.get(sanitizeNodeName(candidate));
      if (name === undefined || taken.has(name)) continue;
      map.set(bone, name);
      taken.add(name);
      break;
    }
  }
  return map;
}

/** The required canonical bones that a bone map does not have. */
export function missingBones(map: BoneMap): HumanBone[] {
  return REQUIRED_HUMAN_BONES.filter((bone) => !map.has(bone));
}

/**
 * The profile of a skeleton from its bone names: the profile with every required bone and the most bones. A tie goes
 * to the first profile of `profiles`. Null when no profile fits: the skeleton plays its own clips only.
 */
export function detectProfile(
  names: Iterable<string>,
  profiles: readonly RigProfile[] = RIG_PROFILES,
): ResolvedProfile | null {
  const list = [...names];
  let best: ResolvedProfile | null = null;
  for (const profile of profiles) {
    const map = resolveProfile(profile, list);
    if (missingBones(map).length > 0) continue;
    if (best === null || map.size > best.map.size) best = { profile, map };
  }
  return best;
}

/** The built-in profile with an ID, or undefined. */
export function profileById(id: string, profiles: readonly RigProfile[] = RIG_PROFILES): RigProfile | undefined {
  return profiles.find((profile) => profile.id === id);
}

/**
 * The profile of an asset: the `rig` value of its record, else the detection from its bone names. `"none"` gives
 * null (the skeleton plays its own clips only). Throws for an unknown ID, or for a named profile that does not fit.
 */
export function profileFor(
  rig: string | undefined,
  names: Iterable<string>,
  profiles: readonly RigProfile[] = RIG_PROFILES,
): ResolvedProfile | null {
  if (rig === NO_RIG_PROFILE) return null;
  if (rig === undefined) return detectProfile(names, profiles);
  const profile = profileById(rig, profiles);
  if (profile === undefined) throw new Error(`"${rig}" is not a rig profile (${profiles.map((p) => p.id).join(", ")})`);
  const map = resolveProfile(profile, names);
  const missing = missingBones(map);
  if (missing.length > 0) throw new Error(`the skeleton has no ${missing.join(", ")} of the rig profile "${rig}"`);
  return { profile, map };
}
