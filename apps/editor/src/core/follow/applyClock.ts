// SPDX-License-Identifier: Apache-2.0
/**
 * Apply the clock state of another window to the clock and the take of this lab. A follower window (a detached pane,
 * the separate content browser) applies each `clock` message of the main lab. The main lab applies each `drive` of a
 * follower. After the call, this clock has the take, the events, the speed, the run state and the time of the state.
 * A paused clock gets the exact time. A clock that runs gets the time of the state at the current wall time
 * (`timeAt`), so two windows draw the same simulation time.
 */
import { decodeEvents, encodeEvents, takeNamed } from "../sequence";
import type { LabClock } from "../useLabClock";
import type { LabTake } from "../useLabTake";
import { timeAt, wallNow, type ClockState } from "../graph/clockLink";

export interface ClockTarget {
  readonly clock: LabClock;
  readonly take: LabTake;
  /** Open an item of the content browser (only a window with the content browser gives it). */
  readonly open?: (item: string) => void;
  /** The current open item of the content browser, or null. */
  readonly item?: () => string | null;
}

/** Apply a clock state. `now` is the wall time of the call (a test gives it). */
export function applyClockState(target: ClockTarget, state: ClockState, now: number = wallNow()): void {
  const { clock, take } = target;
  // First an open item sets its take, its events and its window. Then the take and the time of the state apply.
  if (target.open !== undefined && typeof state.item === "string" && state.item !== (target.item?.() ?? null)) {
    target.open(state.item);
  }
  if (state.take !== take.base.value) {
    const named = takeNamed(state.take);
    take.loadTake(named?.name ?? null);
  }
  if (state.rec !== undefined && state.rec !== encodeEvents(take.events.value)) {
    const events = decodeEvents(state.rec);
    if (events !== null) {
      take.events.value = events;
      take.refresh();
    }
  }
  if (clock.speed.value !== state.speed) clock.setSpeed(state.speed);
  if (state.running) clock.play();
  else clock.pause();
  clock.seek(timeAt(state, now));
}
