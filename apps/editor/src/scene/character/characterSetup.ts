// SPDX-License-Identifier: Apache-2.0
/**
 * The bone map of the character setup: the canonical bones of the humanoid (the fingers apart) and the node of the
 * skeleton of each. The rig profile of the `character` component (`ue5`, `rigify`, `vrm`,
 * `mixamo`) gives a node to each bone that the skeleton has (`resolveProfile` of `@scenity/character/profiles`); the
 * `bones` of the component complete the profile, or give the whole map of a skeleton with no profile (`none`). A
 * required bone with no node is missing, and then the clips of another rig cannot play on the skeleton. The IK handles
 * give the world point of each target entity of the IK goals. Pure functions.
 */
import {
  detectProfile,
  HUMAN_BONES,
  NO_RIG_PROFILE,
  REQUIRED_HUMAN_BONES,
  RIG_PROFILES,
  resolveProfile,
  type HumanBone,
} from "@scenity/character/profiles";
import { CHARACTER_IK_GOALS } from "@scenity/scene/components";
import { parseRef } from "@scenity/scene/refs";
import { worldTransform, type HasEntities } from "@scenity/scene/world";

/** An IK goal of a character. */
export type CharacterIkGoal = (typeof CHARACTER_IK_GOALS)[number];

/** The canonical bones of the table: the humanoid with no finger bones. */
export const SETUP_BONES: readonly HumanBone[] = HUMAN_BONES.map((spec) => spec.name).filter(
  (name) => !/(Proximal|Intermediate|Distal|Metacarpal)$/.test(name),
);

/** One row of the bone map: the bone, its node, and where the node comes from. */
export interface BoneRow {
  readonly bone: HumanBone;
  readonly node: string | null;
  readonly from: "bones" | "profile" | null;
  readonly required: boolean;
}

/** The rows of the bone map of a skeleton with a rig profile and the `bones` of the component. */
export function boneRows(rig: string, names: readonly string[], bones: Readonly<Record<string, string>>): BoneRow[] {
  const profile = RIG_PROFILES.find((item) => item.id === rig);
  const resolved = profile === undefined ? new Map<HumanBone, string>() : resolveProfile(profile, names);
  return SETUP_BONES.map((bone) => {
    const own = bones[bone];
    const node = own ?? resolved.get(bone) ?? null;
    return {
      bone,
      node,
      from: own !== undefined ? "bones" : node === null ? null : "profile",
      required: REQUIRED_HUMAN_BONES.includes(bone),
    };
  });
}

/** The required bones with no node. */
export function missingRows(rows: readonly BoneRow[]): HumanBone[] {
  return rows.filter((row) => row.required && row.node === null).map((row) => row.bone);
}

/** The rig profile that fits the bone names of a skeleton best (`detectProfile`), or `none`. */
export function bestProfile(names: readonly string[]): string {
  return detectProfile(names)?.profile.id ?? NO_RIG_PROFILE;
}

/** The IDs of the rig profiles, with `none`. */
export const RIG_IDS: readonly string[] = [...RIG_PROFILES.map((profile) => profile.id), NO_RIG_PROFILE];

/** The handle of an IK target: the target entity, its world point and the goals that use it. */
export interface IkHandle {
  readonly entity: string;
  readonly point: readonly [number, number, number];
  readonly goals: readonly CharacterIkGoal[];
}

/**
 * The handles of the IK targets of a character: one for each target entity of a goal. A socket target has no handle,
 * because a move of its entity also moves the other sockets of the entity.
 */
export function ikHandles(doc: HasEntities, ik: unknown): IkHandle[] {
  const goals = (typeof ik === "object" && ik !== null ? ik : {}) as Partial<
    Record<CharacterIkGoal, { target?: unknown }>
  >;
  const found = new Map<string, CharacterIkGoal[]>();
  for (const goal of CHARACTER_IK_GOALS) {
    const target = goals[goal]?.target;
    const ref = typeof target === "string" ? parseRef(target) : undefined;
    if (ref?.kind !== "entity" || ref.sub !== undefined) continue;
    found.set(ref.id, [...(found.get(ref.id) ?? []), goal]);
  }
  return [...found].flatMap(([entity, list]) => {
    const world = worldTransform(doc, entity);
    if (world === undefined) return [];
    const [x, y, z] = world.position;
    return [{ entity, point: [x, y, z] as const, goals: list }];
  });
}
