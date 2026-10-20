// SPDX-License-Identifier: Apache-2.0
/**
 * The model of the foot lock widget (`animator.footLock`): the value of the field as legs,
 * the first leg of a model from its bone names (a thigh, a shin and a foot of one side), and the value after a change
 * of one part of a leg. The guess reads the words of the names, so the names of Mixamo, Rigify, UE5 and VRM rigs
 * give a leg. A follow bone with no name goes out of the value.
 */

/** One leg of the foot lock. */
export interface FootLockLeg {
  readonly upper: string;
  readonly lower: string;
  readonly end: string;
  readonly follow?: string;
}

/** The value of the foot lock. */
export interface FootLockValue {
  readonly legs: readonly FootLockLeg[];
  readonly contact?: number;
  readonly fade?: number;
}

/** The parts of a leg. */
export const LEG_PARTS = ["upper", "lower", "end", "follow"] as const;
export type LegPart = (typeof LEG_PARTS)[number];

/** The value of the field, or null for no foot lock. */
export function footLockOf(value: unknown): FootLockValue | null {
  if (typeof value !== "object" || value === null) return null;
  const legs = (value as { legs?: unknown }).legs;
  return Array.isArray(legs) ? (value as FootLockValue) : null;
}

/** The words of a bone name: "mixamorig:LeftUpLeg" gives mixamorig, left, up and leg. */
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
}

/** The words of a helper bone (an IK control, a twist bone, a tip): a leg never uses it. */
const HELPER = ["end", "ik", "pole", "target", "twist", "roll", "ctrl", "mch"];

const isUpper = (list: readonly string[]): boolean =>
  list.includes("thigh") || (list.includes("leg") && (list.includes("up") || list.includes("upper")));
const isLower = (list: readonly string[]): boolean =>
  list.includes("shin") || list.includes("calf") || (list.includes("leg") && !isUpper(list));
const isEnd = (list: readonly string[]): boolean => list.includes("foot") || list.includes("ankle");

/** The side of a bone from its words ("left", "l", "right", "r"), or null. */
function sideOf(name: string): "left" | "right" | null {
  const list = words(name);
  if (list.includes("left") || list.includes("l")) return "left";
  return list.includes("right") || list.includes("r") ? "right" : null;
}

/** The free bone of a side that is of a kind, else the first free bone of the kind. */
function boneOf(
  names: readonly string[],
  kind: (list: readonly string[]) => boolean,
  side: "left" | "right",
  taken: readonly string[],
): string | undefined {
  const free = names.filter((name) => {
    const list = words(name);
    return kind(list) && !taken.includes(name) && !list.some((word) => HELPER.includes(word));
  });
  return free.find((name) => sideOf(name) === side) ?? free[0];
}

/** A new leg from the bone names of a model (the side of the legs that the value has not), or null. */
export function guessLeg(names: readonly string[], legs: readonly FootLockLeg[]): FootLockLeg | null {
  const taken = legs.flatMap((leg) => [leg.upper, leg.lower, leg.end]);
  const side = legs.some((leg) => sideOf(leg.end) === "left") ? "right" : "left";
  const upper = boneOf(names, isUpper, side, taken);
  const lower = boneOf(names, isLower, side, taken);
  const end = boneOf(names, isEnd, side, taken);
  return upper === undefined || lower === undefined || end === undefined ? null : { upper, lower, end };
}

/** The value after a change of a part of a leg (an empty follow goes out). */
export function withLegPart(lock: FootLockValue, index: number, part: LegPart, name: string): FootLockValue {
  const legs = lock.legs.map((leg, at) => {
    if (at !== index) return leg;
    if (part === "follow" && name.trim() === "") return { upper: leg.upper, lower: leg.lower, end: leg.end };
    return { ...leg, [part]: name.trim() };
  });
  return { ...lock, legs };
}
