// SPDX-License-Identifier: Apache-2.0
/**
 * The edit ops of the lab page. The generic op model is in `@scenity/editor-core` (the edit, the source ops, the op
 * kinds and their check). The lab edits three inputs:
 *
 * - A `tune` op sets one tune value (`room.props.<slot>.at.0`, a pose number). Null restores its default.
 * - An `event` op adds one event to the live take (the event type of the plugin, for example a `place` event).
 * - A `source` op asks for a change of the source through a known tool (`labs tune-apply`, `labs camera-save`). The lab
 *   does not apply it. It returns the op as a pending run, and the host runs it.
 *
 * The plugin gives the op kinds of the tune values and of its events (`EditorPlugin.ops`). The tune values and the
 * events are the inputs of a frame (the `tune` and `rec` URL parameters, `frameKey`). Thus an edit gives the same
 * frame as the same values in the URL. This module has no Vue import, because the tools and the tests read it.
 */
import {
  applyTuneOps,
  editProblems as coreEditProblems,
  eventOps as coreEventOps,
  pendingRuns,
  restoreEvents as coreRestoreEvents,
  SOURCE_OP,
  tuneOps,
  withTuneValue,
  withoutEvents as coreWithoutEvents,
  type Edit as CoreEdit,
  type EventOp as CoreEventOp,
  type OpKind,
  type SourceOp,
  type TuneOp,
} from "@scenity/editor-core";
import { editorPlugin } from "../plugin";
import type { LabEvent } from "../sequence";

export {
  applyTuneOps,
  pendingRuns,
  sourceOps,
  tuneOps,
  type PendingRun,
  type SourceOp,
  type TuneOp,
} from "@scenity/editor-core";

/** One event that goes into the live take at its time. */
export type EventOp = CoreEventOp<LabEvent>;

/** The one shape of each edit op of the lab. */
export type EditOp = TuneOp | EventOp | SourceOp;

/** An edit: a named list of ops that is one step of the history. */
export type Edit = CoreEdit<EditOp>;

/** The inputs of a frame that edits change: the tune values and the events of the panel (the `rec` events). */
export interface EditInputs {
  readonly tunes: Readonly<Record<string, number>>;
  readonly events: readonly LabEvent[];
}

/**
 * The data that undo restores after an edit: the tune values before the edit and the events that the edit added.
 * Undo sets the tune values without the default rule, so it also restores a value that is equal to its default.
 */
export interface EditInverse {
  readonly tunes: readonly TuneOp[];
  readonly remove: readonly LabEvent[];
}

/** The list without each event of `remove` (its last occurrence). An event that is not in the list causes no change. */
export function withoutEvents(events: readonly LabEvent[], remove: readonly LabEvent[]): LabEvent[] {
  return coreWithoutEvents<LabEvent>(events, remove);
}

/**
 * The list when the events of edits change from `from` to `to` (an undo or a redo). The events of `from` that are not
 * in `to` are removed. The events of `to` that are not in `from` go to the end. The other events of the list stay.
 */
export function restoreEvents(
  events: readonly LabEvent[],
  from: readonly LabEvent[],
  to: readonly LabEvent[],
): LabEvent[] {
  return coreRestoreEvents<LabEvent>(events, from, to);
}

export function eventOps(ops: readonly EditOp[]): EventOp[] {
  return coreEventOps<LabEvent>(ops);
}

/** The event list after the event ops: each event goes to the end of the list, in the order of the ops. */
export function applyEventOps(events: readonly LabEvent[], ops: readonly EditOp[]): LabEvent[] {
  return [...events, ...eventOps(ops).map((op) => op.event)];
}

/** The inputs after the tune and event ops of an edit, and its source ops as pending runs. */
export function applyOps(
  inputs: EditInputs,
  edit: Edit,
  defaults: ReadonlyMap<string, number>,
): { readonly inputs: EditInputs; readonly pending: ReturnType<typeof pendingRuns> } {
  return {
    inputs: { tunes: applyTuneOps(inputs.tunes, edit.ops, defaults), events: applyEventOps(inputs.events, edit.ops) },
    pending: pendingRuns(edit),
  };
}

/** The inverse of the tune and event ops of an edit on these inputs (the data that undo restores). */
export function inverseOps(inputs: EditInputs, ops: readonly EditOp[]): EditInverse {
  const paths = [...new Set(tuneOps(ops).map((op) => op.path))];
  return {
    tunes: paths.map((path) => ({ kind: "tune", path, value: inputs.tunes[path] ?? null })),
    remove: eventOps(ops).map((op) => op.event),
  };
}

/** The inputs after an inverse: the tune values as they were before the edit, and without the events of the edit. */
export function applyInverse(inputs: EditInputs, inverse: EditInverse): EditInputs {
  let tunes: Record<string, number> = { ...inputs.tunes };
  for (const op of inverse.tunes) tunes = withTuneValue(tunes, op.path, op.value);
  return { tunes, events: withoutEvents(inputs.events, inverse.remove) };
}

/** The op kinds of the lab: the kinds of the plugin (the tune values, its events) and the source ops. */
export function labOpKinds(): readonly OpKind[] {
  return [...editorPlugin().ops, SOURCE_OP];
}

/** The problems of an edit (empty when the edit is correct). `known` tells if a path is a tuned number. */
export function editProblems(edit: unknown, known: (path: string) => boolean): string[] {
  return coreEditProblems(edit, labOpKinds(), { known, defaults: new Map() });
}
