// SPDX-License-Identifier: Apache-2.0
/**
 * The crossfade of the character poses. When the family of a character changes (an arrival at the end of a walk, the
 * start of a new task, the end of a task), the pose goes from the pose of the old input to the pose of the new input
 * over MIX.fadeMs. Without it the hands jump to the new work.
 *
 * The functions are pure: the core keeps the last result and updates it in `update`. The old pose comes from the old
 * input at the time of the change, so a frame at a fixed time after the change is the same frame in the worker and in
 * the main-thread core. A seek drops the memory (forgetHistory): the first frame after it shows the new pose, as a
 * page that opens at that time. A change between two frames at the same time does not fade (an asset load that moves
 * a character, a new input of a stopped clock): no time passes, so the frame shows the new pose, as a page that
 * opens at that time.
 *
 * The families that time their own changes (`ownTiming` of a plugin) do not fade between them.
 */
import { tunable } from "@scenity/scene/tuning";
import { blendGoal, bodyPoint } from "./handBlend";
import { ease, type Vec3 } from "./math";
import type { BodyPose, HandGoal, HeldPose, Placement } from "./place";

/** The length of a crossfade (ms). */
export const MIX = tunable("pose.mix", { fadeMs: 350 });

/** The input fields of a character that the crossfade reads. */
export interface MixInput {
  readonly id: string;
  readonly phaseStartMs: number | null;
}

/** The input and the place of a character in the last frame, and the family of its pose. */
interface Last<Input extends MixInput, Family extends string> {
  readonly family: Family;
  readonly input: Input;
  readonly place: Placement;
  readonly sim: number;
}

/** A crossfade that runs: the old input and place, and the time of the change. */
export interface Fade<Input extends MixInput = MixInput> {
  readonly input: Input;
  readonly place: Placement;
  readonly sinceMs: number;
}

export interface PoseMix<Input extends MixInput = MixInput, Family extends string = string> {
  readonly last: Readonly<Record<string, Last<Input, Family>>>;
  readonly fades: Readonly<Record<string, Fade<Input>>>;
}

export const NO_POSE_MIX: PoseMix<never, never> = { last: {}, fades: {} };

/**
 * The next memory for the pose of a character in a frame. A change of the family starts a fade at the start of the
 * new phase when the view gives it in the time since the last frame, else at the time of the frame. A change between
 * two families of `ownTiming` does not fade.
 */
export function nextPoseMix<Input extends MixInput, Family extends string>(
  mix: PoseMix<Input, Family>,
  input: Input,
  place: Placement,
  family: Family,
  sim: number,
  ownTiming: ReadonlySet<Family>,
): PoseMix<Input, Family> {
  const id = input.id;
  const last = mix.last[id];
  let fade = mix.fades[id];
  if (last !== undefined && sim < last.sim) {
    // A seek back: the frames before do not apply.
    fade = undefined;
  } else if (last?.sim === sim && last.family !== family) {
    // A change at the time of the last frame: the new frame replaces the last frame, without a fade. Else a
    // stopped clock keeps the old pose, because the share of the fade stays at 0.
    fade = undefined;
  } else if (last !== undefined && last.family !== family && !(ownTiming.has(last.family) && ownTiming.has(family))) {
    const start = input.phaseStartMs;
    const sinceMs = start !== null && start > last.sim && start <= sim ? start : sim;
    fade = { input: last.input, place: last.place, sinceMs };
  }
  if (fade !== undefined && sim - fade.sinceMs >= MIX.fadeMs) fade = undefined;
  const fades = Object.fromEntries(Object.entries(mix.fades).filter(([key]) => key !== id));
  if (fade !== undefined) fades[id] = fade;
  return { last: { ...mix.last, [id]: { family, input, place, sim } }, fades };
}

/** The share of the new pose in a fade at `sim` (0 at the change, 1 at the end), or 1 without a fade. */
export function fadeShare(fade: Fade | undefined, sim: number, still: boolean): number {
  if (fade === undefined || still) return 1;
  return ease((sim - fade.sinceMs) / MIX.fadeMs);
}

/**
 * The wrist of a hand at rest (arm angles) as a point: the arm of about 0.6 m hangs from the shoulder, turned forward
 * by `pitch` and out by `spread`. A fade between a hand at rest and a hand on a target moves the wrist on a line.
 */
export function restPoint(at: readonly [number, number], yaw: number, goal: HandGoal, side: -1 | 1): Vec3 {
  if (goal.kind !== "rest") return goal.at;
  const arm = 0.6;
  const forward = arm * Math.sin(goal.pitch);
  const out = 0.18 + arm * Math.sin(goal.spread) * Math.cos(goal.pitch);
  const down = arm * Math.cos(goal.pitch) * Math.cos(goal.spread);
  return bodyPoint(at, yaw, forward, side * out, 1.38 - down);
}

function mixHand(
  from: BodyPose,
  to: BodyPose,
  fromGoal: HandGoal,
  toGoal: HandGoal,
  side: -1 | 1,
  share: number,
): HandGoal {
  if (fromGoal.kind === "rest" && toGoal.kind === "rest") {
    return {
      kind: "rest",
      pitch: fromGoal.pitch + (toGoal.pitch - fromGoal.pitch) * share,
      spread: fromGoal.spread + (toGoal.spread - fromGoal.spread) * share,
    };
  }
  // A hand at rest becomes a target at its wrist point; at the end of the fade the goal is the goal of the new pose.
  const asTarget = (pose: BodyPose, goal: HandGoal): HandGoal =>
    goal.kind === "target" ? goal : { kind: "target", at: restPoint(pose.at, pose.yaw, goal, side), grip: 0.3 };
  if (share >= 1) return toGoal;
  return blendGoal(asTarget(from, fromGoal), asTarget(to, toGoal), share);
}

function mixAngle(from: number, to: number, share: number): number {
  const turn = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + turn * share;
}

function mixLook(from: Vec3 | null, to: Vec3 | null, share: number): Vec3 | null {
  if (from === null || to === null) return share < 0.5 ? from : to;
  return [
    from[0] + (to[0] - from[0]) * share,
    from[1] + (to[1] - from[1]) * share,
    from[2] + (to[2] - from[2]) * share,
  ];
}

/**
 * The pose between the old pose (`share` 0) and the new pose (`share` 1). The new pose gives the other fields (the
 * family and the clip of a plugin pose); the held thing changes at the half share.
 */
export function blendPoses<Pose extends BodyPose & HeldPose>(from: Pose, to: Pose, share: number): Pose {
  if (share >= 1) return to;
  const lerp = (a: number, b: number): number => a + (b - a) * share;
  return {
    ...to,
    at: [lerp(from.at[0], to.at[0]), lerp(from.at[1], to.at[1])],
    yaw: mixAngle(from.yaw, to.yaw, share),
    lean: lerp(from.lean, to.lean),
    crouch: lerp(from.crouch, to.crouch),
    bob: lerp(from.bob, to.bob),
    legSwing: lerp(from.legSwing, to.legSwing),
    nod: lerp(from.nod, to.nod),
    slump: lerp(from.slump ?? 0, to.slump ?? 0),
    jaw: lerp(from.jaw ?? 0, to.jaw ?? 0),
    left: mixHand(from, to, from.left, to.left, -1, share),
    right: mixHand(from, to, from.right, to.right, 1, share),
    look: mixLook(from.look, to.look, share),
    prop: share < 0.5 ? from.prop : to.prop,
    ...(share < 0.5 && from.propHand !== undefined ? { propHand: from.propHand } : {}),
  };
}
