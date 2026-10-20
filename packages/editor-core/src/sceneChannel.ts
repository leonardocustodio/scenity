// SPDX-License-Identifier: Apache-2.0
/**
 * The scene channel of an editor: the open scene document is state of the editor. Each edit is a list of scene ops
 * (the `scene` op kind of ops.ts) and one step of the history. Each change of the document goes to the runtime as scene
 * ops (the "patch" message of the protocol). These are the ops of a live drag when they come, and the diff of the two
 * documents after an edit, an undo or a redo. No Vue import, no DOM.
 *
 * A recorder (the record mode of the sequencer) can change an edit of the document into ops of another channel (the
 * keys of a sequence). Then the edit leaves the document as it is, and the keys are the step of the history. A live
 * drag in the record mode moves the document as usual. Its end restores the document and keys the change.
 */
import type { ComponentRegistry } from "@scenity/scene/components";
import { applyOps, diffDocuments } from "@scenity/scene/ops";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import { EditHistory, type Channel, type EditResult } from "./history";
import { EditError, sceneOpKind, type BaseOp, type Edit, type OpContext, type OpKind, type SceneEditOp } from "./ops";

/** The name of the channel of the scene document in the history. */
export const SCENE_CHANNEL = "scene";

/** The context of the scene ops: they read no tune values. */
const NO_TUNES: OpContext = { known: () => false, defaults: new Map() };

export interface SceneChannelOptions<D extends EntityDocument> {
  /** The document at the load. */
  readonly doc: D;
  readonly registry: ComponentRegistry;
  /** Send scene ops to the runtime (the "patch" message). The channel sends no empty list. */
  readonly patch: (ops: readonly SceneOp[]) => void;
  /** After each change of the document: an edit, a live op, an undo or a redo. */
  readonly onChange?: (doc: D) => void;
  /**
   * More channels of the one history (for example the view state of the hierarchy panel) and the op kinds of their
   * edits. An undo restores the document and these channels together.
   */
  readonly channels?: Readonly<Record<string, Channel<unknown>>>;
  readonly kinds?: readonly OpKind[];
}

/**
 * The record mode hook of a scene channel. While `on` is true, the channel asks `keys` for each edit and at the end of
 * each live drag. `keys` gives ops of other channels in place of the change of the document, or null for a usual edit.
 */
export interface SceneRecorder<D extends EntityDocument = EntityDocument> {
  readonly on: boolean;
  keys(before: D, after: D): readonly BaseOp[] | null;
  /** A live drag shows its keys. `after` is the current document, and `before` is the document at the drag start. */
  show?(before: D, after: D): void;
  /** The live drag ends. Restore the values of `show` (the end step applies the keys through the history). */
  hide?(): void;
}

/** The scene document of an editor with one history for its edits. */
export class SceneChannel<D extends EntityDocument = EntityDocument> {
  readonly history: EditHistory;
  /** The record mode hook, or null. */
  recorder: SceneRecorder<D> | null = null;
  /**
   * The reason why the person cannot change the document (a viewer of the studio), or null. An edit throws an
   * EditError with the reason, and undo and redo do nothing. A live drag returns to its start at its end. The changes
   * of `remote` pass.
   */
  lock: string | null = null;
  #remote = false;
  readonly #kinds: readonly OpKind[];
  readonly #options: SceneChannelOptions<D>;
  #doc: D;
  #count = 0;
  /** The document at the start of a live drag, or null. */
  #start: D | null = null;
  /** True while a live drag of the record mode runs. */
  #recording = false;

  constructor(options: SceneChannelOptions<D>) {
    this.#options = options;
    this.#doc = options.doc;
    this.#kinds = [sceneOpKind(options.registry), ...(options.kinds ?? [])];
    this.history = new EditHistory({
      ...options.channels,
      [SCENE_CHANNEL]: {
        title: "scene",
        read: () => this.#doc,
        write: (next, now) => {
          this.#set(next as D, diffDocuments(now as D, next as D));
        },
        same: (a, b) => a === b,
      },
    });
  }

  /** The current document. */
  get doc(): D {
    return this.#doc;
  }

  /** True while a live drag runs. */
  get live(): boolean {
    return this.#start !== null;
  }

  /** Run `work` with the changes of another window or of the host. A lock does not refuse them. */
  remote<T>(work: () => T): T {
    const before = this.#remote;
    this.#remote = true;
    try {
      return work();
    } finally {
      this.#remote = before;
    }
  }

  /** True when the lock refuses a change at this time. */
  get #locked(): boolean {
    return this.lock !== null && !this.#remote;
  }

  /** Apply scene ops as one step of the history. A refusal throws an EditError and changes nothing. */
  edit(ops: readonly SceneOp[], title: string): EditResult {
    if (this.#locked) throw new EditError(this.lock ?? "");
    if (this.#start !== null) throw new EditError("A live drag runs: end it before an edit.");
    this.#count += 1;
    const sceneOps = ops.map((op): SceneEditOp => ({ kind: "scene", op }));
    const edit = this.#recorded({ id: `scene-${String(this.#count)}`, title, ops: sceneOps });
    return this.history.apply(edit, this.#kinds, NO_TUNES);
  }

  /**
   * Apply an edit of scene ops and ops of the other channels as one step of the history. A refusal throws an EditError
   * and changes nothing.
   */
  apply(edit: Edit<BaseOp>): EditResult {
    if (this.#locked) throw new EditError(this.lock ?? "");
    if (this.#start !== null) throw new EditError("A live drag runs: end it before an edit.");
    return this.history.apply(this.#recorded(edit), this.#kinds, NO_TUNES);
  }

  /** The edit with the keys of the recorder in place of its scene ops, or the edit as it is. */
  #recorded<O extends BaseOp>(edit: Edit<O>): Edit<BaseOp> {
    const recorder = this.recorder;
    if (recorder?.on !== true) return edit;
    const scene = edit.ops.filter((op): op is O & SceneEditOp => op.kind === "scene");
    if (scene.length === 0) return edit;
    const result = applyOps(
      this.#doc,
      scene.map((op) => op.op),
      this.#options.registry,
    );
    if (!result.ok) throw new EditError(result.reason);
    const keys = recorder.keys(this.#doc, result.doc);
    if (keys === null) return edit;
    return { ...edit, ops: [...edit.ops.filter((op) => op.kind !== "scene"), ...keys] };
  }

  /** A live drag starts: its ops change the document and the runtime, and its end is one step. */
  begin(): void {
    if (this.#start !== null) return;
    this.#start = this.#doc;
    this.#recording = this.recorder?.on === true;
    this.history.hold();
  }

  /** Apply ops of a live drag immediately (no step). A refusal throws an EditError and changes nothing. */
  move(ops: readonly SceneOp[]): void {
    if (this.#start === null) throw new EditError("No live drag runs.");
    const result = applyOps(this.#doc, ops, this.#options.registry);
    if (!result.ok) throw new EditError(result.reason);
    this.#set(result.doc, ops);
    if (this.#recording) this.recorder?.show?.(this.#start, this.#doc);
  }

  /** The live drag ends. Its last document is one step. With `cancel`, the document of its start returns. */
  end(cancel = false): void {
    // A lock cancels the drag.
    if (this.#locked) cancel = true;
    const start = this.#start;
    if (start === null) return;
    this.#start = null;
    const recording = this.#recording;
    this.#recording = false;
    if (recording) this.recorder?.hide?.();
    const keys = recording && !cancel ? (this.recorder?.keys(start, this.#doc) ?? null) : null;
    if (cancel || keys !== null) this.#set(start, diffDocuments(this.#doc, start));
    this.history.release();
    if (keys === null) return;
    this.#count += 1;
    this.history.apply({ id: `scene-${String(this.#count)}`, title: "Record keys", ops: keys }, this.#kinds, NO_TUNES);
  }

  undo(): boolean {
    return this.#start === null && !this.#locked && this.history.undo();
  }

  redo(): boolean {
    return this.#start === null && !this.#locked && this.history.redo();
  }

  /** Go to a step of the history in one action (the History panel). False for no change. */
  goTo(index: number): boolean {
    return this.#start === null && !this.#locked && this.history.goTo(index);
  }

  #set(doc: D, ops: readonly SceneOp[]): void {
    if (doc === this.#doc) return;
    this.#doc = doc;
    if (ops.length > 0) this.#options.patch(ops);
    this.#options.onChange?.(doc);
  }
}
