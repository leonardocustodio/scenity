// SPDX-License-Identifier: Apache-2.0
/**
 * The times of the clip kinds of the animation catalog. The engine samples the length of each task phase, so a clip
 * of a phase cannot have a fixed length:
 *
 * - `in/hold/out`: the entry plays from the phase start, the hold loops, and the exit ends at the phase end
 *   (`MemberInput.phaseEndMs`). A phase shorter than the entry and the exit plays both faster.
 * - `once`: a clip with its own length from the phase start; a shorter phase plays it faster (`fitOnce`).
 * - `stroke` and `loop`: one cycle per period.
 *
 * The functions are pure: the same times give the same part.
 */
import { ease } from "./math";

/** The phase times of a character input that the clip times read (a part of the member input of a plugin). */
export interface PhaseInput {
  readonly phaseStartMs: number | null;
  readonly phaseEndMs?: number | null;
}

export type ClipPart = "in" | "hold" | "out";

export interface PartTime {
  readonly part: ClipPart;
  /** The share of the part from 0 to 1 (eased for `in` and `out`; 1 in the hold). */
  readonly share: number;
  /**
   * The weight of the work pose from 0 to 1: the eased share of `in`, 1 in the hold, 1 minus the eased share of `out`.
   * A family blends from the start pose to the work pose with it.
   */
  readonly weight: number;
  /** The time in the hold (ms), for the loop of the hold. 0 outside the hold. */
  readonly holdMs: number;
}

/** The length of the current phase of a character (ms), or null when the view does not give its end. */
export function phaseLength(input: PhaseInput): number | null {
  const end = input.phaseEndMs ?? null;
  const start = input.phaseStartMs;
  return end !== null && start !== null && end > start ? end - start : null;
}

/**
 * The part of an `in/hold/out` clip at `localMs` from the phase start. `phaseMs` is the length of the phase, or null
 * for a phase without a known end (no `out` part). A still pose (reduced motion, a pause) is the hold.
 */
export function inHoldOut(
  localMs: number,
  inMs: number,
  outMs: number,
  phaseMs: number | null,
  still = false,
): PartTime {
  if (still) return { part: "hold", share: 1, weight: 1, holdMs: 0 };
  let entry = inMs;
  let exit = phaseMs === null ? 0 : outMs;
  if (phaseMs !== null && entry + exit > phaseMs) {
    const fit = phaseMs / (entry + exit);
    entry *= fit;
    exit *= fit;
  }
  if (localMs < entry) {
    const share = entry > 0 ? Math.max(0, localMs / entry) : 1;
    return { part: "in", share: ease(share), weight: ease(share), holdMs: 0 };
  }
  if (phaseMs !== null && exit > 0 && localMs >= phaseMs - exit) {
    const share = Math.min(1, (localMs - (phaseMs - exit)) / exit);
    return { part: "out", share: ease(share), weight: 1 - ease(share), holdMs: 0 };
  }
  return { part: "hold", share: 1, weight: 1, holdMs: localMs - entry };
}

/**
 * The time in a `once` clip of the natural length `clipMs` at `localMs` from the phase start: a phase shorter than the
 * clip plays the clip faster, so the clip ends with the phase. A longer phase holds the last frame.
 */
export function fitOnce(localMs: number, clipMs: number, phaseMs: number | null): number {
  if (phaseMs === null || phaseMs >= clipMs || phaseMs <= 0) return Math.max(0, localMs);
  return Math.max(0, localMs) * (clipMs / phaseMs);
}

/** The share of a cycle of `periodMs` at `timeMs` (0 to 1). */
export function cycleShare(timeMs: number, periodMs: number): number {
  return (((timeMs % periodMs) + periodMs) % periodMs) / periodMs;
}
