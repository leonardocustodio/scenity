// SPDX-License-Identifier: Apache-2.0
/**
 * The material channel of an editor. The open material assets are state of the editor, as the scene document is
 * (sceneChannel.ts). It is a channel of the one history: a change of a material is one step, and an undo restores the
 * scene and the materials together.
 *
 * - The state of the channel is the edited document of each material asset (by `asset:<id>`). A material with no edit
 *   shows the document of its file. Thus an undo to a step before the open of a material gives the file values again.
 * - Each change goes to the runtime (`send`) as the documents that changed. The shared material of each asset
 *   changes for each entity that uses it, with no reload of the page.
 * - A live change (the drag of a number or of a colour) shows immediately. Its end is one step (`begin`, `end`).
 * - Each open material has the file state of its `*.material.json` file (the base text and hash of a save). The
 *   page saves it through the scene file port: the canonical writer of the project.
 *
 * No Vue import, no DOM.
 */
import { readDocument } from "@scenity/scene/read";
import type { MaterialDocument } from "@scenity/scene/schema/material";
import type { Channel } from "../history";
import { EditError } from "../ops";
import { SceneFile, type SceneSaveRequest } from "../sceneFile";

/** The name of the channel of the materials in the history. */
export const MATERIAL_CHANNEL = "materials";

/** The edited documents by asset reference. */
export type MaterialEdits = Readonly<Record<string, MaterialDocument>>;

/** The parts of the history that the channel uses: a step for a change, and the hold of a live change. */
export interface MaterialHistory {
  note(): void;
  hold(): void;
  release(): void;
}

/** The result of a save of a material file: the fields of the scene save result that the channel reads. */
export type MaterialSaveResult =
  | { readonly ok: true; readonly path: string; readonly text: string; readonly hash: string }
  | { readonly ok: false; readonly path: string; readonly conflict: boolean; readonly reason?: string };

export interface MaterialChannelOptions {
  /** Send the documents that changed to the runtime (the "load" message with `materials`). */
  readonly send: (docs: MaterialEdits) => void;
}

/** One open material asset: the path of its file and the file state. */
interface OpenMaterial {
  readonly path: string;
  readonly base: MaterialDocument;
  readonly file: SceneFile;
}

/** The open material assets of an editor. `channel` goes into the channels of the one history. */
export class MaterialChannel {
  readonly #options: MaterialChannelOptions;
  readonly #open = new Map<string, OpenMaterial>();
  readonly #listeners = new Set<() => void>();
  #edits: MaterialEdits = {};
  #history: MaterialHistory | null = null;
  /** The edits at the start of a live change, or null. */
  #start: MaterialEdits | null = null;

  constructor(options: MaterialChannelOptions) {
    this.#options = options;
  }

  /** The channel of the history. */
  readonly channel: Channel<unknown> = {
    title: "material",
    read: () => this.#edits,
    write: (next) => {
      this.#set(next as MaterialEdits);
    },
    same: (a, b) => a === b,
  };

  /** Connect the history of the editor: each change of a material is then one step. */
  connect(history: MaterialHistory): void {
    this.#history = history;
  }

  /**
   * Open a material asset from the text of its file. A material that is open already keeps its state. The result is
   * the current document. A text that does not read throws an EditError.
   */
  open(ref: string, path: string, text: string): MaterialDocument {
    const known = this.#open.get(ref);
    if (known !== undefined) return this.doc(ref);
    const read = readDocument(text, "material");
    if (!read.ok) throw new EditError(`The material ${path} does not read: ${read.errors[0]?.message ?? ""}`);
    this.#open.set(ref, { path, base: read.doc, file: new SceneFile(path, read.doc, text) });
    this.#tell();
    return read.doc;
  }

  /** The references of the open materials, in the order of the opens. */
  opened(): string[] {
    return [...this.#open.keys()];
  }

  /** The path of the file of an open material, or null. */
  path(ref: string): string | null {
    return this.#open.get(ref)?.path ?? null;
  }

  /** The current document of an open material: its edit, else the document of its file. */
  doc(ref: string): MaterialDocument {
    const open = this.#open.get(ref);
    if (open === undefined) throw new EditError(`The material ${ref} is not open.`);
    return this.#edits[ref] ?? open.base;
  }

  /** Set the document of an open material: one step of the history, or a live value between `begin` and `end`. */
  set(ref: string, doc: MaterialDocument): void {
    this.doc(ref);
    this.#set({ ...this.#edits, [ref]: doc });
    if (this.#start === null) this.#history?.note();
  }

  /** A live change starts (a drag). Its values show immediately, and `end` keeps its last value as one step. */
  begin(): void {
    if (this.#start !== null) return;
    this.#start = this.#edits;
    this.#history?.hold();
  }

  /** The live change ends. With `cancel`, the values of its start return. */
  end(cancel = false): void {
    const start = this.#start;
    if (start === null) return;
    this.#start = null;
    if (cancel) this.#set(start);
    this.#history?.release();
  }

  /** True when the document of an open material differs from its file. */
  dirty(ref: string): boolean {
    const open = this.#open.get(ref);
    return open?.file.dirty(this.doc(ref)) === true;
  }

  /** The open materials with changes that are not saved. */
  dirtyRefs(): string[] {
    return this.opened().filter((ref) => this.dirty(ref));
  }

  /** The fields of a save of an open material. */
  saveRequest(ref: string, force = false): SceneSaveRequest {
    const open = this.#open.get(ref);
    if (open === undefined) throw new EditError(`The material ${ref} is not open.`);
    return open.file.saveRequest(this.doc(ref), force);
  }

  /** A save of an open material ended: a good save is the new base of the file. */
  saved(ref: string, result: MaterialSaveResult): void {
    const open = this.#open.get(ref);
    if (open === undefined || !result.ok) return;
    open.file.saved(result.text, result.hash);
    this.#tell();
  }

  /** Call `listener` after each change: an open, an edit, an undo, a redo or a save. The result stops it. */
  listen(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #set(next: MaterialEdits): void {
    if (next === this.#edits) return;
    const before = this.#edits;
    this.#edits = next;
    const changed: Record<string, MaterialDocument> = {};
    for (const ref of new Set([...Object.keys(before), ...Object.keys(next)])) {
      const open = this.#open.get(ref);
      const doc = next[ref] ?? open?.base;
      if (doc !== undefined && doc !== (before[ref] ?? open?.base)) changed[ref] = doc;
    }
    if (Object.keys(changed).length > 0) this.#options.send(changed);
    this.#tell();
  }

  #tell(): void {
    for (const listener of this.#listeners) listener();
  }
}
