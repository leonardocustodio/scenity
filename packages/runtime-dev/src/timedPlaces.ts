// SPDX-License-Identifier: Apache-2.0
/**
 * The timed prop places of a lab take: "the crash cart arrives at 40 s". A take event of the lab (the take model of the
 * lab, kind `prop`) puts a prop at a place from its time on. Before that time, the prop is at its tuned place (the
 * `room.props` tune values, else the place of the code). Only a lab take has this feature: a case of the game does not
 * read it. A prop that moves in a case needs a change of the engine contract first.
 *
 * The scene input of the lab carries the list of the timed places (`WithPropTimes.labProps`): the input of the page,
 * of each sample of a sweep, of an index picture and of an onion copy. The dev core (devCore.ts) gives the prop the
 * place of the list at the time of each update, as the tune values of its place (`room.props.<slot>.at.*`, `.yaw`)
 * over the tune values of the page. Thus a frame at a time is a function of its input and its time only: a seek to
 * 41 s and a play to 41 s give the same place, and the list is a function of the take events, which are in `frameKey`.
 *
 * No three.js and no Vue: the lab page and the core both read it.
 */
import type { Vec3 } from "@scenity/character/math";

/** A place of a prop: its position (metres) and its turn about the vertical (radians), as the `room.props` values. */
export interface TimedPlace {
  readonly at: Vec3;
  readonly yaw: number;
}

/** A prop place from a time on: `place` null puts the prop back to its tuned place from that time on. */
export interface PropTime {
  readonly at: number;
  readonly slot: string;
  readonly place: TimedPlace | null;
}

/**
 * The scene input of the lab: the input of the plugin core and the timed prop places of the take (absent: none).
 * `Input` is the scene input of the plugin.
 */
export type WithPropTimes<Input> = Input & { readonly labProps?: readonly PropTime[] };

/** The timed prop places of an input (an input of the runtime has none). */
export function propTimesOf(input: unknown): readonly PropTime[] {
  if (typeof input !== "object" || input === null) return [];
  return (input as WithPropTimes<object>).labProps ?? [];
}

/** The input with the timed prop places (a plain copy of the list); an empty list leaves the input as it is. */
export function withPropTimes<Input extends object>(input: Input, times: readonly PropTime[]): WithPropTimes<Input> {
  if (times.length === 0) return input;
  const labProps = times.map((item) => ({
    at: item.at,
    slot: item.slot,
    place: item.place === null ? null : { at: [...item.place.at] as unknown as Vec3, yaw: item.place.yaw },
  }));
  return { ...input, labProps };
}

/**
 * The tune values of the timed places at `simMs`: for each slot the last entry at or before that time (the order of
 * the list for equal times). A slot whose last entry has no place gets no value (its tuned place applies).
 */
export function propTunesAt(times: readonly PropTime[], simMs: number): Record<string, number> {
  const last = new Map<string, TimedPlace | null>();
  const ordered = times
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.at - b.item.at || a.index - b.index);
  for (const { item } of ordered) {
    if (item.at > simMs) break;
    last.set(item.slot, item.place);
  }
  const out: Record<string, number> = {};
  for (const [slot, place] of last) {
    if (place === null) continue;
    const base = `room.props.${slot}`;
    place.at.forEach((value, axis) => {
      out[`${base}.at.${String(axis)}`] = value;
    });
    out[`${base}.yaw`] = place.yaw;
  }
  return out;
}

/**
 * The tune values that the dev core applies (devCore.ts): the values of the page and, over them, the values of the
 * timed places at the time of an update. `at` gives the values to apply when they changed since the last apply, else
 * null, so a frame without a change of the timed places costs one small lookup.
 */
export class TimedTunes {
  private page: Readonly<Record<string, number>> = {};
  private times: readonly PropTime[] = [];
  private timed: Record<string, number> = {};
  /**
   * The key of the timed values of the last apply. At the start, no timed value is applied. An update without timed
   * places applies nothing: only `setTunes` applies the tune values of the page.
   */
  private applied = "{}";

  /**
   * Set the tune values of the page; gives the values to apply immediately (the timed values of the last update over
   * them).
   */
  setPage(values: Readonly<Record<string, number>>): Record<string, number> {
    this.page = { ...values };
    return { ...this.page, ...this.timed };
  }

  /** The timed places of the input of the next updates. */
  setTimes(times: readonly PropTime[]): void {
    this.times = times;
  }

  /**
   * The tune values of a pane with its own values (null: the values of the page), with the timed values at `simMs` over
   * them. The next `at` of the same time then gives null, so the update keeps them.
   */
  paneValues(values: Readonly<Record<string, number>> | null, simMs: number): Record<string, number> {
    this.at(simMs);
    return { ...(values ?? this.page), ...this.timed };
  }

  /** The tune values to apply at an update at `simMs`, or null when they are the values of the last apply. */
  at(simMs: number): Record<string, number> | null {
    const timed = this.times.length === 0 ? {} : propTunesAt(this.times, simMs);
    const key = JSON.stringify(timed);
    if (key === this.applied) return null;
    this.applied = key;
    this.timed = timed;
    return { ...this.page, ...timed };
  }
}
