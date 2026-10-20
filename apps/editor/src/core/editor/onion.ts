// SPDX-License-Identifier: Apache-2.0
/**
 * The onion skin of the lab page: the state of the view (on or off, the step, the number of copies on each side, the
 * capture mode), the offsets of the copies from the clock time, the URL flag and the spec for the labs core
 * (`@scenity/runtime-dev` `onion.ts` draws the copies).
 *
 * - **The copies**: `count` copies before and `count` after the clock time, `step` ms apart. The defaults are 2 and
 *   250 ms: five poses with the current pose. The copies before are blue and the copies after are orange. The opacity
 *   decreases with the distance from the clock time (`@scenity/runtime-dev` ONION_COLORS, ONION_OPACITY).
 * - **The members**: the selected member, or the whole team when no member is selected.
 * - **The samples**: the scene input of each time of a copy, from the take events of the page (as the sweep), while
 *   the clock stops. The core poses the scene with them. A time without a sample has no copy.
 * - **The URL flag** `onion=<mode>[,<step>[,<count>]]`: the mode `1` (or `on`) shows the copies in the panes. The mode
 *   `capture` also shows them in every capture (a sheet of `labs sheet` or `lab_sheet` in one picture). It is a view
 *   flag, not a frame input. It is not in `frameKey`, and the frame index never shows the copies.
 *
 * Pure functions: no Vue import.
 */
import type { SceneInput } from "../../plugins";
import type { OnionSpec } from "@scenity/runtime-dev";
import { t } from "../../texts";

export interface OnionState {
  readonly on: boolean;
  /** The time between two copies (ms). */
  readonly step: number;
  /** The copies on each side of the clock time. */
  readonly count: number;
  /** True: every capture shows the copies. */
  readonly capture: boolean;
}

/** The limits of the step (ms) and of the count of copies on each side. */
export const ONION_LIMITS = { step: { min: 50, max: 2000 }, count: { min: 1, max: 3 } } as const;
export const ONION_OFF: OnionState = { on: false, step: 250, count: 2, capture: false };

/** A change of the state (the command `view.onion`). Absent parts stay. If `on` is absent, the onion skin toggles. */
export interface OnionChange {
  readonly on?: boolean;
  readonly step?: number;
  readonly count?: number;
  readonly capture?: boolean;
}

const clamp = (value: number, limit: { readonly min: number; readonly max: number }): number =>
  Math.min(limit.max, Math.max(limit.min, Math.round(value)));

/** The state after a change. */
export function changeOnion(state: OnionState, change: OnionChange): OnionState {
  return {
    on: change.on ?? !state.on,
    step: change.step === undefined ? state.step : clamp(change.step, ONION_LIMITS.step),
    count: change.count === undefined ? state.count : clamp(change.count, ONION_LIMITS.count),
    capture: change.capture ?? state.capture,
  };
}

/** The offsets of the copies from the clock time (ms), the far copies before first. Example: [-500, -250, 250, 500]. */
export function onionOffsets(state: Pick<OnionState, "step" | "count">): number[] {
  const side = Array.from({ length: state.count }, (_, index) => (index + 1) * state.step);
  return [...side.map((offset) => -offset).reverse(), ...side];
}

/**
 * The spec for the core: the members (the selected member, else the team), the offsets, and the samples. A sample is
 * the scene input (from `inputAt`) at each time of a copy around the clock time `at`, as the samples of the sweep. A
 * time before 0 has no sample. Off gives no offsets. No clock time or no input (a clock that runs, a live session)
 * gives no samples.
 */
export function onionSpec(
  state: OnionState,
  member: string | null,
  at: number | null = null,
  inputAt: ((time: number) => SceneInput) | null = null,
): OnionSpec {
  const offsets = state.on ? onionOffsets(state) : [];
  const times = at === null || inputAt === null ? [] : offsets.map((offset) => at + offset).filter((time) => time >= 0);
  return {
    members: member === null ? null : [member],
    offsets,
    capture: state.on && state.capture,
    samples: times
      .map((time) => ({ simMs: time, input: inputAt?.(time) ?? null }))
      .flatMap((item) => (item.input === null ? [] : [{ simMs: item.simMs, input: item.input }])),
  };
}

/** The state of the URL flag `onion=<mode>[,<step>[,<count>]]`. No flag, or a flag that is not valid, gives off. */
export function parseOnion(value: string | null): OnionState {
  if (value === null || value === "" || value === "0") return ONION_OFF;
  const [mode = "", step, count] = value.split(",");
  if (mode !== "1" && mode !== "on" && mode !== "capture") return ONION_OFF;
  const number = (text: string | undefined): number | undefined => {
    const parsed = text === undefined ? Number.NaN : Number(text);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const change: OnionChange = { on: true, capture: mode === "capture" };
  const stepValue = number(step);
  const countValue = number(count);
  return changeOnion(ONION_OFF, {
    ...change,
    ...(stepValue === undefined ? {} : { step: stepValue }),
    ...(countValue === undefined ? {} : { count: countValue }),
  });
}

/** The words of the state: "onion skin ±250 ms × 2 (blue before, orange after)". */
export function onionWords(state: OnionState): string {
  if (!state.on) return t("commands-onion-words-off");
  const words = { step: String(state.step), count: String(state.count) };
  return state.capture ? t("commands-onion-words-capture", words) : t("commands-onion-words", words);
}
