// SPDX-License-Identifier: Apache-2.0
/**
 * The event listeners of a player. A listener that throws does not stop the other listeners: the error goes
 * to the console.
 */
import type { PlayerEventName, PlayerEvents } from "./types";

type Listener<E extends PlayerEventName> = (detail: PlayerEvents[E]) => void;

export class PlayerEmitter {
  readonly #listeners = new Map<PlayerEventName, Set<Listener<PlayerEventName>>>();

  on<E extends PlayerEventName>(event: E, listener: Listener<E>): () => void {
    const set = this.#listeners.get(event) ?? new Set();
    set.add(listener as Listener<PlayerEventName>);
    this.#listeners.set(event, set);
    return () => {
      set.delete(listener as Listener<PlayerEventName>);
    };
  }

  emit<E extends PlayerEventName>(event: E, detail: PlayerEvents[E]): void {
    for (const listener of [...(this.#listeners.get(event) ?? [])]) {
      try {
        listener(detail);
      } catch (error) {
        console.error(error);
      }
    }
  }

  clear(): void {
    this.#listeners.clear();
  }
}
