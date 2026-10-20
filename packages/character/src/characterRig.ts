// SPDX-License-Identifier: Apache-2.0
/**
 * The rig of a character on its model: the bone map of the `character` component (a rig profile, the
 * profile from the bone names, and the bone names of the component over them), the node of a canonical bone, and
 * the clips of another model through the retarget.
 */
import type { AnimationClip, Object3D } from "three";
import type { HumanBone } from "./profiles/humanoid";
import { profileFor, sanitizeNodeName, type BoneMap } from "./profiles/resolve";
import { restPoseOf } from "./rest";
import { retargetClip } from "./retarget";

/** The rig part of a `character` component value (or of a clip source of an animator). */
export interface RigValue {
  readonly rig?: string | undefined;
  readonly bones?: Readonly<Record<string, string>> | undefined;
}

/** The names of the nodes of a model: the bones first, then the other nodes, each name once. */
function nodeNames(model: Object3D): string[] {
  const bones: string[] = [];
  const others: string[] = [];
  model.traverse((node) => {
    ((node as Partial<{ isBone: boolean }>).isBone === true ? bones : others).push(node.name);
  });
  return [...new Set([...bones, ...others])];
}

/**
 * The bone map of a character model: the profile of `value.rig` (or from the bone names), then the bone names of
 * `value.bones` over it. The map holds the node names of the loaded model: a name of `value.bones` goes through
 * `findNode`, so `UpperArm.L` gives the node `UpperArmL` of the glTF loader. A profile that does not fit gives an
 * empty map under `value.bones`, and `problems` gets the reason. A bone name with no node stays as it is, and
 * `problems` gets it.
 */
export function characterBones(model: Object3D, value: RigValue, problems: string[] = []): BoneMap {
  const map = new Map<HumanBone, string>();
  try {
    for (const [bone, name] of profileFor(value.rig, nodeNames(model))?.map ?? []) map.set(bone, name);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  for (const [bone, name] of Object.entries(value.bones ?? {})) {
    const node = findNode(model, name);
    if (node === undefined) problems.push(`the model has no node "${name}" for the bone "${bone}"`);
    map.set(bone as HumanBone, node?.name ?? name);
  }
  return map;
}

/**
 * The node of a model with a name. The names compare as written and in the form of the glTF loader of three.js
 * (`sanitizeNodeName`: `UpperArm.L` finds `UpperArmL`). The order of choice:
 *
 * 1. a bone with the name;
 * 2. a bone with the name and the suffix that the loader adds to a name that a node before it has (`Torso_1`, when
 *    a mesh "Torso" comes before the bone "Torso");
 * 3. any node with the name.
 */
export function findNode(model: Object3D, name: string): Object3D | undefined {
  const form = sanitizeNodeName(name);
  const suffix = new RegExp(`^(?:${escapeName(name)}|${escapeName(form)})_\\d+$`);
  let bone: Object3D | undefined;
  let renamed: Object3D | undefined;
  let other: Object3D | undefined;
  model.traverse((node) => {
    if (bone !== undefined) return;
    const isBone = (node as Partial<{ isBone: boolean }>).isBone === true;
    const same = node.name === name || node.name === form;
    if (same && isBone) bone = node;
    else if (same) other ??= node;
    else if (isBone && suffix.test(node.name)) renamed ??= node;
  });
  return bone ?? renamed ?? other;
}

/** A name as a literal part of a regular expression. */
function escapeName(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The node of a canonical bone through the bone map, else the node with that name. */
export function boneNode(model: Object3D, map: BoneMap, name: string): Object3D | undefined {
  return findNode(model, map.get(name as HumanBone) ?? name);
}

/**
 * The clips of a source model on a target model: the retarget through the bone maps of the two rigs, at
 * load time. A rig with no humanoid map gives no clips, and `problems` gets the reason.
 */
export function clipsFrom(
  source: Object3D,
  sourceRig: RigValue,
  target: Object3D,
  targetRig: RigValue,
  problems: string[] = [],
): AnimationClip[] {
  const fromMap = characterBones(source, sourceRig, problems);
  const toMap = characterBones(target, targetRig, problems);
  if (fromMap.size === 0 || toMap.size === 0) {
    problems.push("a clip source needs a humanoid rig on both models");
    return [];
  }
  const fromRest = restPoseOf(source);
  const toRest = restPoseOf(target);
  // The retarget reads the bone maps; the profile arguments only name the rigs.
  const profile = { id: "map", name: "map", bones: {} };
  return source.animations.map((clip) => retargetClip(clip, profile, profile, fromRest, toRest, { fromMap, toMap }));
}
