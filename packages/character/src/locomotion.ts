// SPDX-License-Identifier: Apache-2.0
/**
 * The place of a character in a frame: at its slot, or on a walk to it. The function is pure: the core keeps the
 * motion of each character and gives it to the next frame.
 */
import { tunable } from "@scenity/scene/tuning";
import { pathLength, planWalk, timedWalk, walkState, type Walk } from "./path";
import { yawTo, type FloorRect, type Placement, type Slot } from "./place";

/** The input fields of a character that the locomotion reads (a part of the member input of a plugin). */
export interface WalkerInput {
  /** The activity of the character: "walk" while the engine walks it. */
  readonly activity: string;
  /** The start of the current phase (ms): the engine walk starts there. */
  readonly phaseStartMs: number | null;
  /** True while the character cannot walk: it stays at its place. */
  readonly unavailable: boolean;
  /** The end of the engine walk (ms), or null for a walk at the natural speed. */
  readonly walkEndMs: number | null;
  /** The anchor that an engine walk leaves, or null. */
  readonly fromAnchor?: string | null;
}

/** The floor of a walk: the obstacles, and the slot of an anchor (the place that a walk leaves). */
export interface WalkFloor {
  readonly obstacles: readonly FloorRect[];
  slotOf(anchor: string): Slot | undefined;
}

/**
 * The times of a walk of the choreography of a plugin: the start and the end (null: the natural speed), and the slot
 * that the walk leaves.
 */
export interface SlotTiming {
  readonly startMs: number;
  readonly endMs: number | null;
  readonly from?: Slot;
}

/**
 * A turn to the facing of a stand point (clip_turn_left_90, clip_turn_right_90, clip_turn_180): a small turn takes
 * `minMs`, a quarter turn `quarterMs` and a half turn `halfMs`.
 */
export const TURN = tunable("pose.turn", { minMs: 350, quarterMs: 600, halfMs: 900 });

/**
 * A side step (clip_sidestep_left, clip_sidestep_right): a straight walk of at most `maxM` metres that goes more to the
 * side of the facing than to the front. The member keeps its facing, and a walk without an engine time takes `ms`.
 */
export const SIDESTEP = tunable("pose.sidestep", { maxM: 0.7, ms: 600 });

/** The length of a turn in place from one facing to another (ms). */
export function turnLength(fromYaw: number, toYaw: number): number {
  const angle = Math.abs(Math.atan2(Math.sin(toYaw - fromYaw), Math.cos(toYaw - fromYaw)));
  const share = (angle - Math.PI / 2) / (Math.PI / 2);
  return Math.min(TURN.halfMs, Math.max(TURN.minMs, TURN.quarterMs + (TURN.halfMs - TURN.quarterMs) * share));
}

/** The side of a walk that is a side step for a member that faces `faceYaw`, or null for a walk to the front. */
export function sidestepOf(walk: Walk, faceYaw: number): "left" | "right" | null {
  const [from, to] = walk.path;
  if (walk.path.length !== 2 || from === undefined || to === undefined) return null;
  const length = pathLength(walk.path);
  if (length < 1e-6 || length > SIDESTEP.maxM) return null;
  // The right of a member that faces +z is −x.
  const right = (to[0] - from[0]) * -Math.cos(faceYaw) + (to[1] - from[1]) * Math.sin(faceYaw);
  if (Math.abs(right) / length < Math.SQRT1_2) return null;
  return right > 0 ? "right" : "left";
}

/** A side step without a time of the engine or of the choreography takes SIDESTEP.ms. */
function sidestepTimed(walk: Walk | null, faceYaw: number, natural: boolean): Walk | null {
  if (walk === null || !natural || sidestepOf(walk, faceYaw) === null) return walk;
  return { ...walk, endMs: walk.startMs + SIDESTEP.ms };
}

/** The motion of a member after a frame: its place in that frame, its walk, the slot of the walk and its turn. */
export interface Motion {
  readonly place: Placement;
  readonly walk: Walk | null;
  readonly target: readonly [number, number];
  readonly turnFrom: number;
  readonly turnAt: number;
}

function angleLerp(from: number, to: number, share: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * share;
}

/** The place that a walk of the character leaves (a walk of the choreography, else an engine walk), or null. */
export function walkOrigin(member: WalkerInput, timing: SlotTiming | null, floor: WalkFloor): Slot | null {
  if (timing !== null) return timing.from ?? null;
  if (member.activity !== "walk" || member.fromAnchor === undefined || member.fromAnchor === null) return null;
  return floor.slotOf(member.fromAnchor) ?? null;
}

/**
 * The motion of a member at its slot, or on a walk to it, after the motion of the frame before (`last`; undefined in
 * the first frame). `timing` gives the times of a walk of the choreography of a plugin. `jump` puts the member at the
 * slot without a walk: the place moved under the member.
 */
export function locomotion(
  last: Motion | undefined,
  member: WalkerInput,
  slot: Slot,
  sim: number | null,
  still: boolean,
  timing: SlotTiming | null,
  jump: boolean,
  floor: WalkFloor,
): Motion {
  const now = sim ?? 0;
  const faceYaw = yawTo(slot.at, slot.face);
  let at: readonly [number, number];
  let yaw: number;
  let walk: Walk | null = null;
  let target: readonly [number, number];
  let turnFrom: number;
  let turnAt = Number.NEGATIVE_INFINITY;
  if (last === undefined) {
    // The first frame of a member (or the first after a seek or a new layout): on a walk it starts at the place that
    // the walk leaves, so the walk below puts it on its path at this time.
    const from = sim === null || still ? null : walkOrigin(member, timing, floor);
    const start = from ?? slot;
    at = start.at;
    target = start.at;
    yaw = yawTo(start.at, start.face);
    turnFrom = yaw;
  } else {
    ({ at, yaw } = last.place);
    ({ walk, target, turnFrom, turnAt } = last);
  }
  const moved = Math.hypot(slot.at[0] - target[0], slot.at[1] - target[1]) > 0.05;
  if (moved) {
    target = slot.at;
    // The engine walk is the approach phase: it starts at the start of that phase.
    const walkStartMs = member.activity === "walk" ? member.phaseStartMs : null;
    // `jump`: the place moved under the member (the step stool appeared after its clip loaded), not a walk.
    const planned =
      sim === null || member.unavailable || jump
        ? null
        : timing !== null
          ? timedWalk(at, slot.at, floor.obstacles, timing.startMs, timing.endMs)
          : planWalk(at, slot.at, floor.obstacles, now, member.walkEndMs, walkStartMs);
    const next = sidestepTimed(planned, faceYaw, timing === null && member.walkEndMs === null);
    if (next === null || next.endMs <= now) {
      at = slot.at;
      walk = null;
      // A walk that ended before this frame: the turn to the facing started at its end, as in a frame of that time.
      turnFrom = next === null ? faceYaw : endHeading(next, faceYaw);
      turnAt = next === null ? Number.NEGATIVE_INFINITY : next.endMs;
    } else {
      walk = next;
    }
  }
  let place: Placement | null = null;
  if (walk !== null) {
    const state = walkState(walk, now);
    if (state.done) {
      at = walk.path[walk.path.length - 1] ?? slot.at;
      // The turn starts at the end of the walk, not at the frame that sees the end: the same time gives the same pose.
      turnAt = walk.endMs;
      turnFrom = endHeading(walk, faceYaw);
      walk = null;
    } else {
      place = walkingPlace(walk, now, at, yaw, faceYaw, still);
    }
  }
  place ??= standPlace(at, turnFrom, faceYaw, turnAt, now, still);
  return { place, walk, target, turnFrom, turnAt };
}

/**
 * The place of a member on a walk. Reduced motion: no glide; the member stays until the walk ends, then stands at its
 * slot. A side step keeps the facing of the stand point.
 */
function walkingPlace(
  walk: Walk,
  now: number,
  at: readonly [number, number],
  yaw: number,
  faceYaw: number,
  still: boolean,
): Placement {
  const state = walkState(walk, now);
  if (still) return { at, yaw, walking: false, speed: state.speed };
  const side = sidestepOf(walk, faceYaw);
  return {
    at: state.at,
    yaw: side === null ? state.heading : faceYaw,
    walking: true,
    speed: state.speed,
    walkStartMs: walk.startMs,
    walkEndMs: walk.endMs,
    ...(side === null ? {} : { sidestep: side }),
  };
}

/** The facing at the end of a walk: its heading, or the facing of the stand point after a side step. */
function endHeading(walk: Walk, faceYaw: number): number {
  return sidestepOf(walk, faceYaw) === null ? walkState(walk, walk.endMs).heading : faceYaw;
}

/** The place of a member that stands: it turns from `turnFrom` to `faceYaw` from `turnAt` (Placement.turn). */
function standPlace(
  at: readonly [number, number],
  turnFrom: number,
  faceYaw: number,
  turnAt: number,
  now: number,
  still: boolean,
): Placement {
  const ms = turnLength(turnFrom, faceYaw);
  const age = now - turnAt;
  const share = still ? 1 : Math.min(1, Math.max(0, age / ms));
  const yaw = angleLerp(turnFrom, faceYaw, share);
  const turning = !still && age >= 0 && age < ms;
  return turning
    ? { at, yaw, walking: false, speed: 0, turn: { fromYaw: turnFrom, toYaw: faceYaw, startMs: turnAt, ms } }
    : { at, yaw, walking: false, speed: 0 };
}
