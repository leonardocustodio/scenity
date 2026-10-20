// SPDX-License-Identifier: Apache-2.0
/**
 * The history of the scene editor of the lab page: the Vue side of the one history of `@scenity/editor-core`
 * (`EditHistory`). Its channels are the tune values, the events that edits added to the take and the scratch list (a
 * lab input). Each change of the tune values is a step (a drag, a key turn, a nudge, a field of the Tune tab, a reset).
 * Each change of the scratch list is a step too (a move, a duplicate, a delete, an import). A drag is one step. ⌘Z and
 * ⇧⌘Z undo and redo. An edit (ops.ts) is one step for all of its ops.
 *
 * An undo restores the tune values and the scratch list. It removes only the events of the undone edit
 * (`restoreEvents`). An event of the panel or of the keys between two edits stays in the take. Other changes of the
 * event list (the panel, `load`, `setEvents`) are not steps.
 */
import { EditHistory, restoreEvents, sameTunes, type Channel } from "@scenity/editor-core";
import { onBeforeUnmount, ref, watch, type Ref } from "vue";
import type { TuneUndo } from "../edit/tuneHistory";
import type { ScratchEntry } from "../scratch/scratchList";
import type { LabEvent } from "../sequence";
import { labOpKinds, type Edit } from "./ops";
import { t } from "../../texts";

/** A state of the history. */
export interface EditState {
  readonly tunes: Readonly<Record<string, number>>;
  /** The events that edits added to the take, in their order. */
  readonly events: readonly LabEvent[];
  /** The edit that made the state; null for another change, and for the start. */
  readonly edit: { readonly id: string; readonly title: string } | null;
}

/** The events of the panel of the live take (useLabTake.ts): the events after the take and `team=0`. */
export interface EditTake {
  panel(): readonly LabEvent[];
  setEvents(events: readonly LabEvent[]): void;
}

/** The steps of the history for the script API: the current state and the edit of each state. */
export interface EditSteps {
  readonly index: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Step 0 is the oldest state that the history keeps. A step without an edit is another change of an input. */
  readonly steps: readonly { readonly id: string | null; readonly title: string; readonly events: number }[];
}

export interface EditUndo extends TuneUndo {
  /** Apply the ops of an edit as one step. Returns false when they change no input (then there is no step). */
  record(edit: Edit, defaults: ReadonlyMap<string, number>): boolean;
  steps(): EditSteps;
}

/** The channel of the tune values. */
function tuneChannel(tunes: Ref<Record<string, number>>): Channel<Readonly<Record<string, number>>> {
  return {
    title: t("commands-view-history-tunes"),
    read: () => tunes.value,
    write: (next) => {
      tunes.value = { ...next };
    },
    same: sameTunes,
    copy: (value) => ({ ...value }),
  };
}

/** The channel of the events that edits added. A write puts the events of the step in the take; other events stay. */
function eventChannel(take: EditTake): Channel<readonly LabEvent[]> {
  let added: readonly LabEvent[] = [];
  return {
    title: t("commands-view-history-events"),
    read: () => added,
    write: (next, now) => {
      if (now.length > 0 || next.length > 0) take.setEvents(restoreEvents(take.panel(), now, next));
      added = next;
    },
    same: (a, b) => a.length === b.length && a.every((event, index) => event === b[index]),
    copy: (value) => [...value],
  };
}

/** The channel of the scratch list: a shallow ref of plain entries. */
function scratchChannel(list: Ref<ScratchEntry[]>): Channel<readonly ScratchEntry[]> {
  return {
    title: t("commands-view-history-scratch"),
    read: () => list.value,
    write: (next) => {
      list.value = [...next];
    },
    same: (a, b) => a.length === b.length && a.every((entry, index) => entry === b[index]),
  };
}

/** The undo and redo of the tune values, the events of edits and the scratch list of the page. */
export function useEditHistory(
  tunes: Ref<Record<string, number>>,
  take: EditTake,
  scratch?: Ref<ScratchEntry[]>,
): EditUndo {
  const channels: Record<string, Channel<unknown>> = { tunes: tuneChannel(tunes), events: eventChannel(take) };
  if (scratch !== undefined) channels.scratch = scratchChannel(scratch);
  const history = new EditHistory(channels);
  const canUndo = ref(false);
  const canRedo = ref(false);
  const sync = (): void => {
    canUndo.value = history.canUndo;
    canRedo.value = history.canRedo;
  };
  // A sync watch: the flags of an undo, an edit and a drag hold while the watch runs.
  const note = (): void => {
    history.note();
    sync();
  };
  const stops = [watch(tunes, note, { flush: "sync" })];
  if (scratch !== undefined) stops.push(watch(scratch, note, { flush: "sync" }));
  onBeforeUnmount(() => {
    for (const stop of stops) stop();
  });
  return {
    canUndo,
    canRedo,
    undo: () => {
      history.undo();
      sync();
    },
    redo: () => {
      history.redo();
      sync();
    },
    begin: () => {
      history.hold();
    },
    end: () => {
      history.release();
      sync();
    },
    record: (edit, defaults) => {
      const applied = history.apply(edit, labOpKinds(), { known: (path) => defaults.has(path), defaults }).applied;
      sync();
      return applied;
    },
    steps: () => {
      const { steps, index } = history.steps();
      return {
        index,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        steps: steps.map((step) => ({
          id: step.label?.id ?? null,
          title: step.label?.title ?? "start",
          events: (step.values.events as readonly LabEvent[] | undefined)?.length ?? 0,
        })),
      };
    },
  };
}
