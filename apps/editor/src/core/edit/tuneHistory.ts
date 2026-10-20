// SPDX-License-Identifier: Apache-2.0
/**
 * The undo and redo of the tune values. Each change of the tune values is a step (a drag, a key turn, a nudge, a field
 * of the Tune tab, a reset). A drag is one step. The history holds its steps while the drag runs and keeps only its
 * end. ⌘Z undoes a step, and ⇧⌘Z (or Ctrl+Y) does it again.
 */
import { HISTORY_STEPS, sameTunes, StateHistory } from "@scenity/editor-core";
import { onBeforeUnmount, ref, watch, type Ref } from "vue";

// The history of a state and the compare of tune values are in @scenity/editor-core.
export { HISTORY_STEPS, sameTunes, StateHistory } from "@scenity/editor-core";

type Tunes = Readonly<Record<string, number>>;

/** The history of only the tune values. */
export class TuneHistory extends StateHistory<Tunes> {
  constructor(start: Tunes, max = HISTORY_STEPS) {
    super(start, sameTunes, (state) => ({ ...state }), max);
  }
}

export interface TuneUndo {
  readonly canUndo: Ref<boolean>;
  readonly canRedo: Ref<boolean>;
  undo(): void;
  redo(): void;
  /** A drag starts: its changes are not steps until `end`. */
  begin(): void;
  /** The drag ends: its last state is one step. */
  end(): void;
}

/** The undo and redo of the tune values of the page. */
export function useTuneHistory(tunes: Ref<Record<string, number>>): TuneUndo {
  const history = new TuneHistory(tunes.value);
  const canUndo = ref(false);
  const canRedo = ref(false);
  let holding = false;
  let restoring = false;
  const sync = (): void => {
    canUndo.value = history.canUndo;
    canRedo.value = history.canRedo;
  };
  // A sync watch, so the flags of an undo and of a drag stay set while the watch runs.
  const stop = watch(
    tunes,
    (state) => {
      if (restoring || holding) return;
      history.record(state);
      sync();
    },
    { flush: "sync" },
  );
  const restore = (state: Tunes | null): void => {
    if (state === null) return;
    restoring = true;
    tunes.value = { ...state };
    restoring = false;
    sync();
  };
  onBeforeUnmount(stop);
  return {
    canUndo,
    canRedo,
    undo: () => {
      restore(history.undo());
    },
    redo: () => {
      restore(history.redo());
    },
    begin: () => {
      holding = true;
    },
    end: () => {
      holding = false;
      history.record(tunes.value);
      sync();
    },
  };
}
