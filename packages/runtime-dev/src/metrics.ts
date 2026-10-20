// SPDX-License-Identifier: Apache-2.0
/**
 * The generic motion metrics of the 3D scene: numbers with a unit from an inspect report (what the renderer drew), so
 * an agent checks a pose with a limit and not by eye. The functions are pure. A plugin adds its own metrics and puts
 * the values of one frame in its order (its `measureReport`).
 *
 * | Metric | What it measures |
 * | --- | --- |
 * | `ik.reachError` | The largest distance from a wrist to its target (m); not in a family that the plugin skips |
 * | `feet.belowFloor` | How far an ankle is lower than 4 cm over the floor or the step under the member (m) |
 * | `members.overlap` | How far two members that stand still are nearer than 0.36 m to each other (m) |
 * | `joints.elbow`, `joints.knee` | The smallest angle at an elbow or a knee (degrees; 180 is straight) |
 */
import type { FloorRect } from "@scenity/character/place";
import type { Vec3 } from "@scenity/character/math";
import type { Joints, MemberReport } from "./inspect";

/** The names of the generic metrics. */
export const GENERIC_METRICS = [
  "ik.reachError",
  "feet.belowFloor",
  "members.overlap",
  "joints.elbow",
  "joints.knee",
] as const;

export type GenericMetric = (typeof GENERIC_METRICS)[number];

/** One value of a metric. `Name` is the union of the metric names of the plugin. */
export interface MetricValue<Name extends string = string> {
  readonly metric: Name;
  readonly value: number;
  readonly unit: "m" | "deg";
  /** The member that the value is of, or null for the scene. */
  readonly member: string | null;
}

/** Two members that stand still keep this distance between their stand points (two half body widths). */
const PERSONAL_SPACE = 0.36;
/** An ankle stays this high over the floor or the step under the member. */
const ANKLE_HEIGHT = 0.04;

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The distance of two points over the floor (x, z). */
export function floorDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

/** The angle at `joint` between the bones to `a` and to `b`, in degrees. */
export function jointAngle(a: Vec3, joint: Vec3, b: Vec3): number {
  const u = [a[0] - joint[0], a[1] - joint[1], a[2] - joint[2]] as const;
  const v = [b[0] - joint[0], b[1] - joint[1], b[2] - joint[2]] as const;
  const lengths = Math.hypot(...u) * Math.hypot(...v);
  if (lengths === 0) return 180;
  const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / lengths;
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

function smallestAngle(joints: Joints, chains: readonly (readonly [keyof Joints, keyof Joints, keyof Joints])[]) {
  let smallest: number | null = null;
  for (const [a, joint, b] of chains) {
    const pa = joints[a];
    const pj = joints[joint];
    const pb = joints[b];
    if (pa === undefined || pj === undefined || pb === undefined) continue;
    const angle = jointAngle(pa, pj, pb);
    smallest = smallest === null ? angle : Math.min(smallest, angle);
  }
  return smallest;
}

/** How far the floor point (x, z) is inside the rectangle (0 outside). */
export function insideRect(rect: FloorRect, x: number, z: number): number {
  return Math.max(0, Math.min(x - rect.minX, rect.maxX - x, z - rect.minZ, rect.maxZ - z));
}

/** The largest distance from a wrist to its target (m), or null for a member without a hand target. */
export function reachError(member: MemberReport): number | null {
  const errors = member.hands.flatMap((hand) => (hand.target === null ? [] : [distance(hand.target, hand.wrist)]));
  return errors.length > 0 ? Math.max(...errors) : null;
}

/** How far the lower ankle is below its height over the floor or the step under the member (m), or null. */
export function feetBelowFloor(member: MemberReport): number | null {
  const ankles = [member.joints.ankle_l, member.joints.ankle_r].filter((ankle) => ankle !== undefined);
  if (ankles.length === 0) return null;
  const low = Math.min(...ankles.map((ankle) => ankle[1]));
  return Math.max(0, member.lift + ANKLE_HEIGHT - low);
}

/** The smallest elbow angle and the smallest knee angle of a member (degrees), each null without its joints. */
export function limbAngles(member: MemberReport): { readonly elbow: number | null; readonly knee: number | null } {
  const elbow = smallestAngle(member.joints, [
    ["shoulder_l", "elbow_l", "wrist_l"],
    ["shoulder_r", "elbow_r", "wrist_r"],
  ]);
  const knee = smallestAngle(member.joints, [
    ["hip_l", "knee_l", "ankle_l"],
    ["hip_r", "knee_r", "ankle_r"],
  ]);
  return { elbow, knee };
}

/** The `members.overlap` value of each pair of the members that stand still, in the order of the report. */
export function overlapValues(shown: readonly MemberReport[]): MetricValue<"members.overlap">[] {
  const out: MetricValue<"members.overlap">[] = [];
  const still = shown.filter((member) => !member.walking);
  for (const [index, member] of still.entries()) {
    for (const other of still.slice(index + 1)) {
      const gap = Math.hypot(member.at[0] - other.at[0], member.at[1] - other.at[1]);
      out.push({
        metric: "members.overlap",
        value: Math.max(0, PERSONAL_SPACE - gap),
        unit: "m",
        member: `${member.id}+${other.id}`,
      });
    }
  }
  return out;
}
