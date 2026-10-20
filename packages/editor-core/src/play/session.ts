// SPDX-License-Identifier: Apache-2.0
/**
 * The play mode of an editor: the edit state and the play state are separate.
 *
 * - `enter` keeps a mark of the one history: the values of each channel (the scene, the view state, the sequence)
 *   and the steps. The play state starts as the edit state.
 * - During the play mode, an edit (the gizmo, the inspector, a command) changes the play state through the same
 *   channels. An undo moves back over the steps of the play mode.
 * - `stop` restores the mark: the values of each channel and the steps. Thus the edit state returns exactly, and the
 *   steps of the play mode go.
 * - `keep` stops, then applies the chosen parts of the changes (changes.ts) to the edit state as one step of the
 *   history. The record mode does not apply to that step: a kept value goes into the document as it is.
 *
 * The page runs the clock, the systems and the simulation of the play mode. This module keeps only the edit state.
 * No Vue import, no DOM.
 */
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SequenceDocument } from "@scenity/scene/sequence";
import type { EditResult, HistoryMark } from "../history";
import { EditError, type BaseOp } from "../ops";
import { SCENE_CHANNEL, type SceneChannel } from "../sceneChannel";
import { SEQUENCE_CHANNEL } from "../sequence/edits";
import { sceneChanges, sequenceChange, type PlayChange } from "./changes";

export class PlaySession<D extends SceneDocument = SceneDocument> {
  readonly #channel: SceneChannel<D>;
  #mark: HistoryMark | null = null;
  #count = 0;

  constructor(channel: SceneChannel<D>) {
    this.#channel = channel;
  }

  /** True while the play mode runs. */
  get active(): boolean {
    return this.#mark !== null;
  }

  /** The scene document of the edit state: the document at `enter` while the play mode runs, else the current one. */
  get editDoc(): D {
    return (this.#mark?.values[SCENE_CHANNEL] as D | undefined) ?? this.#channel.doc;
  }

  /** Start the play mode. It throws an EditError while the play mode or a live drag runs. */
  enter(): void {
    if (this.#mark !== null) throw new EditError("The play mode runs already.");
    if (this.#channel.live) throw new EditError("A live drag runs: end it before the play mode.");
    this.#mark = this.#channel.history.mark();
  }

  /** The parts of the play state that differ from the edit state. Empty when the play mode does not run. */
  changes(): PlayChange[] {
    const mark = this.#mark;
    if (mark === null) return [];
    const now = this.#channel.history.read();
    const scene = sceneChanges(mark.values[SCENE_CHANNEL] as D, this.#channel.doc);
    const editSequence = mark.values[SEQUENCE_CHANNEL] as SequenceDocument | undefined;
    const playSequence = now[SEQUENCE_CHANNEL] as SequenceDocument | undefined;
    const sequence =
      editSequence === undefined || playSequence === undefined ? null : sequenceChange(editSequence, playSequence);
    return sequence === null ? scene : [...scene, sequence];
  }

  /** Stop the play mode: the edit state and its steps return. A live drag ends first (cancelled). */
  stop(): void {
    const mark = this.#mark;
    if (mark === null) return;
    if (this.#channel.live) this.#channel.end(true);
    // The play mode ends before the rewind. Thus the listeners of the channels see the edit state.
    this.#mark = null;
    this.#channel.history.rewind(mark);
  }

  /**
   * Stop the play mode and apply the parts with the IDs `ids` (all parts with no IDs) to the edit state as one step of
   * the history. The result tells whether a step was made. It throws an EditError when the play mode does not run.
   */
  keep(ids?: readonly string[]): EditResult {
    if (this.#mark === null) throw new EditError("The play mode does not run.");
    const chosen = this.changes().filter((change) => ids === undefined || ids.includes(change.id));
    this.stop();
    const ops: BaseOp[] = chosen.flatMap((change) => change.ops);
    if (ops.length === 0) return { applied: false, pending: [] };
    this.#count += 1;
    const recorder = this.#channel.recorder;
    this.#channel.recorder = null;
    try {
      const title = chosen.length === 1 ? `Keep ${chosen[0]?.label ?? ""}` : `Keep ${String(chosen.length)} changes`;
      return this.#channel.apply({ id: `play-keep-${String(this.#count)}`, title, ops });
    } finally {
      this.#channel.recorder = recorder;
    }
  }
}
