// SPDX-License-Identifier: Apache-2.0
/**
 * The input events of a play session. This module has no zod, so a render worker can
 * use it (`@scenity/scene/input`).
 *
 * - An input event has a simulation time `t` (whole ms), a kind (`press` or `release`), an action of the input map of
 *   a plugin, and for a pointer the entity and the world point of the hit.
 * - An event applies at a step boundary of the systems, never at a wall-clock time: the step at time `s` gets the
 *   events with a time in (`s` - dt, `s`]. Thus the system memory at a time is a function of the documents, the
 *   events and the time. A replay of a recording gives the frames of the live session.
 * - `InputTrack` keeps the events in time order. An event at a time before the last step makes the steps from its
 *   time stale (the document core runs them again).
 * - A simulation can reduce the events as action keys. `withInputs` adds them to a sequence as one action track. The
 *   key of an event has the args `kind`, `entity` and `point`.
 */
import { roundNumber } from "../canonical";
import type { InputEvent } from "../schema/input";
import type { ActionKey, SequenceDocument } from "../schema/sequence";

export type { InputEvent, InputKind } from "../schema/input";

/** The input events of one step of the systems (`ctx.inputs` of a system). */
export interface StepInputs {
  /** The events of the step, in time order: a time after the step before and at or before the step time. */
  readonly events: readonly InputEvent[];
  /** The `press` events of an action in the step. */
  pressed(action: string): readonly InputEvent[];
  /** True when the action has more presses than releases at or before the step time (a key that stays down). */
  held(action: string): boolean;
}

/** An input event with a whole ms time and its point on the number grid of the documents. */
export function inputEvent(event: InputEvent): InputEvent {
  const { t, kind, action, entity, point } = event;
  const base: InputEvent = { t: Math.max(0, Math.round(t)), kind, action };
  const at = point === undefined ? {} : { point: point.map(roundNumber) as [number, number, number] };
  return { ...base, ...(entity === undefined ? {} : { entity }), ...at };
}

/** The count of events with a time at or before `t` (the events are in time order). */
export function eventsAtOrBefore(events: readonly InputEvent[], t: number): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((events[middle]?.t ?? 0) <= t) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The inputs of a step from the events in (from, t]. The held actions come from all the events at or before `t`. */
function stepInputs(events: readonly InputEvent[], from: number, t: number): StepInputs {
  const end = eventsAtOrBefore(events, t);
  const step = events.slice(eventsAtOrBefore(events, from), end);
  let counts: Map<string, number> | null = null;
  return {
    events: step,
    pressed: (action) => step.filter((event) => event.action === action && event.kind === "press"),
    held(action) {
      if (counts === null) {
        counts = new Map();
        for (let index = 0; index < end; index += 1) {
          const event = events[index];
          if (event === undefined) continue;
          const count = (counts.get(event.action) ?? 0) + (event.kind === "press" ? 1 : -1);
          counts.set(event.action, Math.max(0, count));
        }
      }
      return (counts.get(action) ?? 0) > 0;
    },
  };
}

/** The input step with no events (a step before the first event, or a core with no input). */
export const NO_INPUTS: StepInputs = stepInputs([], 0, 0);

/** The input events of a session in time order. Events at the same time keep the order of their arrival. */
export class InputTrack {
  #events: InputEvent[] = [];

  /** The events in time order. */
  get events(): readonly InputEvent[] {
    return this.#events;
  }

  /** Add events. The result is the earliest time of an added event, or null when the list is empty. */
  add(events: readonly InputEvent[]): number | null {
    let first: number | null = null;
    for (const raw of events) {
      const event = inputEvent(raw);
      this.#events.splice(eventsAtOrBefore(this.#events, event.t), 0, event);
      first = first === null ? event.t : Math.min(first, event.t);
    }
    return first;
  }

  /** Replace all the events. The result is the earliest time that changes (0), or null when both lists are empty. */
  replace(events: readonly InputEvent[]): number | null {
    const before = this.#events.length;
    this.#events = [];
    const first = this.add(events);
    return before === 0 && first === null ? null : 0;
  }

  /** The inputs of the step at the time `t`. `from` is the time of the step before it (-1 for the first step). */
  step(from: number, t: number): StepInputs {
    return this.#events.length === 0 ? NO_INPUTS : stepInputs(this.#events, from, t);
  }
}

/** The action key of an input event: the args hold the kind, the entity and the point. */
function actionKey(event: InputEvent): ActionKey {
  const args: Record<string, string | number[]> = { kind: event.kind };
  if (event.entity !== undefined) args.entity = event.entity;
  if (event.point !== undefined) args.point = [...event.point];
  return { t: event.t, action: event.action, args };
}

/**
 * The sequence with the input events as one more action track at its end (without the events after the duration). The
 * evaluator gives each key to the simulation of the plugin of its action. With no events, the result is the sequence.
 */
export function withInputs(sequence: SequenceDocument, events: readonly InputEvent[]): SequenceDocument {
  const keys = events.filter((event) => event.t <= sequence.duration).map(actionKey);
  if (keys.length === 0) return sequence;
  return { ...sequence, tracks: [...sequence.tracks, { kind: "action", keys }] };
}
