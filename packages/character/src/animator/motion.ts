// SPDX-License-Identifier: Apache-2.0
/**
 * The motions of the animator states: the weights of a 1D blend, the length of a motion, the play rate of a
 * state and the clip times of a state at a normalized time. The functions are pure.
 */
import type { AnimatorMotion, AnimatorState } from "@scenity/scene/components";
import type { Parameters } from "./parameters";

/** The lengths of the clips of the model in seconds, by clip name. */
export type ClipLengths = Readonly<Record<string, number>>;

/** One weighted motion of a layer pose: a clip at a clip time, or a procedural motion of a plugin. */
export type MotionSample =
  | {
      readonly kind: "clip";
      readonly clip: string;
      /** The clip time in seconds. */
      readonly time: number;
      readonly weight: number;
    }
  | {
      readonly kind: "procedural";
      readonly id: string;
      /** The time in the cycle of the motion in seconds. */
      readonly time: number;
      /** The normalized time of the state (1: one cycle; it does not wrap). */
      readonly phase: number;
      readonly weight: number;
    };

function numberOf(params: Parameters, name: string): number {
  const value = params[name];
  return typeof value === "number" ? value : 0;
}

/** The weight of each point of a 1D blend at the value `at`: one point, or two neighbours with linear weights. */
export function blendWeights(points: readonly { readonly at: number }[], at: number): number[] {
  const weights = points.map(() => 0);
  const last = points.length - 1;
  if (last < 0) return weights;
  if (at <= (points[0]?.at ?? 0)) weights[0] = 1;
  else if (at >= (points[last]?.at ?? 0)) weights[last] = 1;
  else {
    for (let index = 0; index < last; index += 1) {
      const low = points[index]?.at ?? 0;
      const high = points[index + 1]?.at ?? 0;
      if (at < low || at > high) continue;
      const share = (at - low) / (high - low);
      weights[index] = 1 - share;
      weights[index + 1] = share;
      break;
    }
  }
  return weights;
}

/** The length of one cycle of a motion in ms at the parameter values (0: a motion with no length). */
export function motionLength(motion: AnimatorMotion, clips: ClipLengths, params: Parameters): number {
  if (motion.kind === "clip") return (clips[motion.clip] ?? 0) * 1000;
  if (motion.kind === "procedural") return motion.duration * 1000;
  const weights = blendWeights(motion.points, numberOf(params, motion.parameter));
  let length = 0;
  motion.points.forEach((point, index) => {
    length += ((weights[index] ?? 0) * (clips[point.clip] ?? 0) * 1000) / (point.speed ?? 1);
  });
  return length;
}

/** The change of the normalized time of a state in one ms: the speeds over the length of one cycle. */
export function stateRate(state: AnimatorState, clips: ClipLengths, params: Parameters, speed: number): number {
  const length = motionLength(state.motion, clips, params);
  if (length <= 0) return 0;
  const factor = state.speedParameter === undefined ? 1 : numberOf(params, state.speedParameter);
  return (Math.max(0, (state.speed ?? 1) * factor) * speed) / length;
}

/** The normalized time in the current cycle: the fraction for a loop, else the time clamped to 0..1. */
export function cycleOf(state: AnimatorState, phase: number): number {
  if (state.loop === false) return Math.min(1, Math.max(0, phase));
  return phase - Math.floor(phase);
}

/** The motion samples of a state at the normalized time `phase`, each with the weight `weight`. */
export function motionSamples(
  state: AnimatorState,
  phase: number,
  weight: number,
  clips: ClipLengths,
  params: Parameters,
): MotionSample[] {
  const motion = state.motion;
  const cycle = cycleOf(state, phase);
  if (motion.kind === "clip") {
    return [{ kind: "clip", clip: motion.clip, time: cycle * (clips[motion.clip] ?? 0), weight }];
  }
  if (motion.kind === "procedural") {
    return [{ kind: "procedural", id: motion.id, time: cycle * motion.duration, phase, weight }];
  }
  const weights = blendWeights(motion.points, numberOf(params, motion.parameter));
  const out: MotionSample[] = [];
  motion.points.forEach((point, index) => {
    const share = weights[index] ?? 0;
    if (share > 0)
      out.push({ kind: "clip", clip: point.clip, time: cycle * (clips[point.clip] ?? 0), weight: share * weight });
  });
  return out;
}
