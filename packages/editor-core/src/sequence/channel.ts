// SPDX-License-Identifier: Apache-2.0
/**
 * The sequence channel of an editor: the open `*.sequence.json` document is state of the editor, as the scene document
 * is (sceneChannel.ts). It is a channel of the one history: a sequence op is one step, and an undo restores the scene
 * and the sequence together. Each change goes to the runtime (`send`). Thus the page plays the edited sequence
 * immediately. The record mode (`SequenceRecorder`) changes an edit of the scene at the time of the clock into keys
 * (record.ts). No Vue import, no DOM.
 */
import type { EntityDocument } from "@scenity/scene";
import type { SequenceDocument } from "@scenity/scene/sequence";
import type { Channel } from "../history";
import type { BaseOp } from "../ops";
import type { SceneRecorder } from "../sceneChannel";
import { recordOps } from "./record";
import { applySequenceChange, type SequenceOp } from "./edits";

export interface SequenceChannelOptions {
  /** The document at the load. */
  readonly doc: SequenceDocument;
  /** Send the document to the runtime after each change. */
  readonly send: (doc: SequenceDocument) => void;
  /** After each change of the document: an op, an undo, a redo or a live value. */
  readonly onChange?: (doc: SequenceDocument) => void;
}

/** The sequence document of an editor. `channel` goes into the channels of the one history. */
export class SequenceChannel {
  readonly #options: SequenceChannelOptions;
  readonly #listeners = new Set<(doc: SequenceDocument) => void>();
  #doc: SequenceDocument;

  constructor(options: SequenceChannelOptions) {
    this.#options = options;
    this.#doc = options.doc;
  }

  /** The channel of the history. */
  readonly channel: Channel<unknown> = {
    title: "sequence",
    read: () => this.#doc,
    write: (next) => {
      this.#set(next as SequenceDocument);
    },
    same: (a, b) => a === b,
  };

  get doc(): SequenceDocument {
    return this.#doc;
  }

  /**
   * Show a value with no step of the history: a drag of a key, or the keys of a live drag of the record mode. The
   * caller restores the value before the step of its end.
   */
  setLive(doc: SequenceDocument): void {
    this.#set(doc);
  }

  /** Call `listener` after each change of the document. The result stops it. */
  listen(listener: (doc: SequenceDocument) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #set(doc: SequenceDocument): void {
    if (doc === this.#doc) return;
    this.#doc = doc;
    this.#options.send(doc);
    this.#options.onChange?.(doc);
    for (const listener of this.#listeners) listener(doc);
  }
}

/** The document after sequence ops (a preview of the record mode). A bad op throws an EditError. */
export function applySequenceOps(doc: SequenceDocument, ops: readonly SequenceOp[]): SequenceDocument {
  return ops.reduce((value, op) => applySequenceChange(value, op.change), doc);
}

/** The record mode of a sequence channel: the recorder of the scene channel (`SceneChannel.recorder`). */
export class SequenceRecorder<D extends EntityDocument = EntityDocument> implements SceneRecorder<D> {
  on = false;
  /** The sequence at the start of a live drag, or null. */
  #start: SequenceDocument | null = null;

  /** @param time the time of the clock (ms) */
  constructor(
    private readonly sequence: SequenceChannel,
    private readonly time: () => number,
  ) {}

  keys(before: D, after: D): readonly BaseOp[] | null {
    return recordOps(before, after, this.#start ?? this.sequence.doc, this.time());
  }

  show(before: D, after: D): void {
    this.#start ??= this.sequence.doc;
    const ops = recordOps(before, after, this.#start, this.time());
    this.sequence.setLive(ops === null ? this.#start : applySequenceOps(this.#start, ops));
  }

  hide(): void {
    if (this.#start !== null) this.sequence.setLive(this.#start);
    this.#start = null;
  }
}
