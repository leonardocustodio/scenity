// SPDX-License-Identifier: Apache-2.0
/**
 * The prefab set of the page editor: the prefab documents by their project path, the channel of the one history (an
 * apply of overrides changes the set as one step), and the prefabs that the page loads later with no step (the file of
 * a new instance, a new prefab). An undo keeps the later prefabs in the set. Each new set goes to `send` (the runtime)
 * and to the listeners.
 */
import type { Channel, PrefabSet } from "@scenity/editor-core";
import { t } from "../../texts";

export class PrefabSetState {
  #set: PrefabSet;
  /** The prefabs that the page loaded after the start. */
  #loaded: PrefabSet = {};
  readonly #listeners = new Set<(set: PrefabSet) => void>();
  readonly #send: (set: PrefabSet) => void;

  constructor(set: PrefabSet, send: (set: PrefabSet) => void) {
    this.#set = set;
    this.#send = send;
  }

  get set(): PrefabSet {
    return this.#set;
  }

  /** The channel of the one history: a change sends the new expansion to the runtime. */
  channel(): Channel<unknown> {
    return {
      title: t("scene-history-prefabs"),
      read: () => this.#set,
      // The set of the history stays the same object when the page loaded no prefab after the start.
      write: (next) =>
        this.#use(
          Object.keys(this.#loaded).length === 0 ? (next as PrefabSet) : { ...this.#loaded, ...(next as PrefabSet) },
        ),
      same: (a, b) => a === b,
    };
  }

  /** Add prefabs to the set with no step of the history, and send them. */
  add(prefabs: PrefabSet): void {
    this.#loaded = { ...this.#loaded, ...prefabs };
    this.#use({ ...this.#set, ...prefabs });
  }

  /** Call `listener` after each change of the set; the result stops it. */
  listen(listener: (set: PrefabSet) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #use(set: PrefabSet): void {
    this.#set = set;
    this.#send(set);
    for (const listener of this.#listeners) listener(set);
  }
}
