// SPDX-License-Identifier: Apache-2.0
/**
 * The event ops: an op kind of the channel `events`. An event op adds one event to the live sequence at its time. The
 * channel holds the events that edits added, in their order. The other events of the sequence (a panel, the keys) are
 * not in it. Thus an undo removes only the events of its edit. A plugin gives the check of its event type
 * (`eventOpKind`). The functions are pure. No Vue import.
 */
import { defineOpKind, opsOfKind, type BaseOp, type EventOp, type OpKind } from "./ops";

export function eventOps<E = unknown>(ops: readonly BaseOp[]): EventOp<E>[] {
  return opsOfKind<EventOp<E>>(ops, "event");
}

/** The event list after the event ops: each event goes to the end of the list, in the order of the ops. */
export function applyEventOps<E>(events: readonly E[], ops: readonly BaseOp[]): E[] {
  return [...events, ...eventOps<E>(ops).map((op) => op.event)];
}

/** The index of the last event of the list that is `event` (the same object, else the same JSON), or -1. */
function lastIndexOf<E>(events: readonly E[], event: E): number {
  const same = events.lastIndexOf(event);
  if (same >= 0) return same;
  const text = JSON.stringify(event);
  return events.findLastIndex((item) => JSON.stringify(item) === text);
}

/** The list without each event of `remove` (its last occurrence). An event that is not in the list is no change. */
export function withoutEvents<E>(events: readonly E[], remove: readonly E[]): E[] {
  const next = [...events];
  for (const event of remove) {
    const index = lastIndexOf(next, event);
    if (index >= 0) next.splice(index, 1);
  }
  return next;
}

/**
 * The list when the events of edits go from `from` to `to` (an undo or a redo). The events of `from` that are not in
 * `to` go out. The events of `to` that are not in `from` go to the end. The other events of the list stay.
 */
export function restoreEvents<E>(events: readonly E[], from: readonly E[], to: readonly E[]): E[] {
  const gone = from.filter((event) => !to.includes(event));
  const come = to.filter((event) => !from.includes(event));
  return [...withoutEvents(events, gone), ...come];
}

/**
 * The op kind of the events of a plugin (channel `events`). `check` gives the problem of an event (an unknown kind, a
 * bad time), or null. The apply adds a copy of the event, so each event of an edit is its own object.
 */
export function eventOpKind<E extends object>(
  check: (event: unknown) => string | null,
): OpKind<EventOp<E>, readonly E[]> {
  return defineOpKind<EventOp<E>, readonly E[]>({
    kind: "event",
    channel: "events",
    problem: (op) => check(op.event),
    apply: (events, op) => [...events, { ...op.event }],
  });
}
