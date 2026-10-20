// SPDX-License-Identifier: Apache-2.0
/**
 * The walks of a `locomotion` component over time: each walk goes from the place of the actor at its start
 * time to a stand point, on the path of `planPath` around the obstacles, then the actor turns to the facing of the
 * stand point. The start, the end of the path and the end of the turn of each walk are fixed times, so the place at a
 * time is a pure function of the walk plan and the time: a seek equals a play. The walk speed goes to an animator
 * parameter, with a change only at those times (the animator checks its transitions there).
 *
 * The heading turns smoothly at each corner of a path: in a window around the corner whose length comes from the turn
 * speed, at most half of each side of the corner.
 */
import type { ParameterSource } from "./animator/parameters";
import { pathLength, planPath, pointAt, type FloorPoint } from "./path";
import type { FloorRect } from "./place";

/** A place on the floor and a yaw (0 faces +z, π/2 faces +x). */
export interface FloorPose {
  readonly at: FloorPoint;
  readonly yaw: number;
}

/** One walk of a plan: at `t` (ms), walk to `at`, then turn to `yaw`. */
export interface WalkTarget extends FloorPose {
  readonly t: number;
}

/** One walk with its path and its times (integer ms). */
export interface WalkLeg {
  readonly startMs: number;
  /** The time of the arrival at the end of the path. */
  readonly arriveMs: number;
  /** The end of the turn to the facing of the stand point. */
  readonly endMs: number;
  readonly path: readonly FloorPoint[];
  readonly fromYaw: number;
  readonly toYaw: number;
}

/** The walks of an actor: the start pose and the legs in time order. */
export interface WalkPlan {
  readonly start: FloorPose;
  readonly legs: readonly WalkLeg[];
  /** The walk speed in metres per second. */
  readonly speed: number;
  /** The turn speed in radians per second. */
  readonly turnSpeed: number;
}

/** The place of an actor at a time, its walk speed (0 when it stands or turns) and whether it walks. */
export interface WalkFrame extends FloorPose {
  readonly speed: number;
  readonly walking: boolean;
}

/** A walk shorter than this (metres) is no walk: the actor only turns. */
const MIN_WALK = 0.05;

/** The signed difference of two angles in (-π, π]. */
function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function angleLerp(from: number, to: number, share: number): number {
  return from + angleDelta(from, to) * Math.min(1, Math.max(0, share));
}

/** The heading of each segment of a path, and the distance from the start to the start of each segment. */
function segments(path: readonly FloorPoint[]): { headings: number[]; starts: number[]; lengths: number[] } {
  const headings: number[] = [];
  const starts: number[] = [];
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1] ?? [0, 0];
    const b = path[index] ?? [0, 0];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    headings.push(Math.atan2(b[0] - a[0], b[1] - a[1]));
    starts.push(total);
    lengths.push(length);
    total += length;
  }
  return { headings, starts, lengths };
}

/**
 * The yaw at the distance `d` along the path of a leg. The first corner turns from the yaw at the start to the first
 * heading after the start; each other corner turns in a window centred on it.
 */
function headingAt(leg: WalkLeg, d: number, speed: number, turnSpeed: number): number {
  const { headings, starts, lengths } = segments(leg.path);
  const metresPerRad = speed / turnSpeed;
  let index = 0;
  while (index < starts.length - 1 && d >= (starts[index + 1] ?? 0)) index += 1;
  const heading = headings[index] ?? leg.fromYaw;
  const start = starts[index] ?? 0;
  const length = lengths[index] ?? 0;
  const before = index === 0 ? leg.fromYaw : (headings[index - 1] ?? heading);
  // The corner at the start of the segment: one-sided at the start of the path.
  const window = Math.abs(angleDelta(before, heading)) * metresPerRad;
  if (index === 0) {
    const w = Math.min(window, length / 2);
    if (d < w) return angleLerp(before, heading, d / w);
  } else {
    const w = Math.min(window / 2, length / 2, (lengths[index - 1] ?? 0) / 2);
    if (d < start + w) return angleLerp(before, heading, (d - (start - w)) / (2 * w));
  }
  const after = headings[index + 1];
  if (after !== undefined) {
    const w = Math.min(
      (Math.abs(angleDelta(heading, after)) * metresPerRad) / 2,
      length / 2,
      (lengths[index + 1] ?? 0) / 2,
    );
    const corner = start + length;
    if (d > corner - w) return angleLerp(heading, after, (d - (corner - w)) / (2 * w));
  }
  return heading;
}

/** The frame of one leg at a time at or after its start. */
function legFrame(leg: WalkLeg, t: number, speed: number, turnSpeed: number): WalkFrame {
  const last = leg.path[leg.path.length - 1] ?? [0, 0];
  if (t < leg.arriveMs) {
    const share = (t - leg.startMs) / (leg.arriveMs - leg.startMs);
    const { at } = pointAt(leg.path, share);
    const yaw = headingAt(leg, share * pathLength(leg.path), speed, turnSpeed);
    return { at, yaw, speed, walking: true };
  }
  const { headings } = segments(leg.path);
  const arriveYaw = headings[headings.length - 1] ?? leg.fromYaw;
  const share = leg.endMs > leg.arriveMs ? (t - leg.arriveMs) / (leg.endMs - leg.arriveMs) : 1;
  return { at: last, yaw: angleLerp(arriveYaw, leg.toYaw, share), speed: 0, walking: false };
}

/** The frame of a plan at a time (ms): the start pose before the first walk, else the frame of the last leg. */
export function walkFrame(plan: WalkPlan, t: number): WalkFrame {
  let leg: WalkLeg | undefined;
  for (const item of plan.legs) if (item.startMs <= t) leg = item;
  if (leg === undefined) return { ...plan.start, speed: 0, walking: false };
  return legFrame(leg, t, plan.speed, plan.turnSpeed);
}

/**
 * The walk plan to the targets. Each walk starts at the place of the actor at its time: a walk that starts
 * before the walk before it ends cuts it there.
 */
export function planWalks(
  start: FloorPose,
  targets: readonly WalkTarget[],
  obstacles: readonly FloorRect[],
  speed: number,
  turnSpeed: number,
): WalkPlan {
  const legs: WalkLeg[] = [];
  for (const target of targets) {
    const startMs = Math.round(target.t);
    const from = walkFrame({ start, legs, speed, turnSpeed }, startMs);
    const far = Math.hypot(target.at[0] - from.at[0], target.at[1] - from.at[1]) >= MIN_WALK;
    const path = far ? planPath(from.at, target.at, obstacles) : [from.at, from.at];
    const arriveMs = startMs + (far ? Math.max(1, Math.round((pathLength(path) / speed) * 1000)) : 0);
    const { headings } = segments(path);
    const arriveYaw = far ? (headings[headings.length - 1] ?? from.yaw) : from.yaw;
    const turnMs = Math.round((Math.abs(angleDelta(arriveYaw, target.yaw)) / turnSpeed) * 1000);
    legs.push({ startMs, arriveMs, endMs: arriveMs + turnMs, path, fromYaw: from.yaw, toYaw: target.yaw });
  }
  return { start, legs, speed, turnSpeed };
}

/** The times in (from, to] where the walk speed of a plan can change: the start and the arrival of each leg. */
export function walkChanges(plan: WalkPlan, from: number, to: number): number[] {
  const times = new Set<number>();
  for (const leg of plan.legs) {
    for (const t of [leg.startMs, leg.arriveMs]) if (t > from && t <= to) times.add(t);
  }
  // determinism: ordered (the sort gives the order)
  return [...times].sort((a, b) => a - b);
}

/**
 * The parameters of an animator with the walk speed of a plan in `parameter`: the walk speed while the actor walks,
 * else 0. The other parameters and their change times come from `base`.
 */
export function walkParameters(plan: WalkPlan, parameter: string, base: ParameterSource): ParameterSource {
  return {
    at(t) {
      return { ...base.at(t), [parameter]: walkFrame(plan, t).speed };
    },
    changes(from, to) {
      const times = new Set([...base.changes(from, to), ...walkChanges(plan, from, to)]);
      // determinism: ordered (the sort gives the order)
      return [...times].sort((a, b) => a - b);
    },
  };
}
