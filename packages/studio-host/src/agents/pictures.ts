// SPDX-License-Identifier: Apache-2.0
/**
 * The pictures of the tool results of the agent sessions: a tool card of the transcript shows the pictures of its
 * result. The host keeps the newest `PICTURES_MAX` pictures in memory. The transcript has their IDs, and the panel
 * reads each one at `GET /api/agent/pictures/<id>`.
 */

/** The most pictures that the host keeps. */
export const PICTURES_MAX = 200;

/** A picture of a tool result. */
export interface StoredPicture {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mime: string;
}

/** The pictures of the sessions, the oldest first. */
export class PictureStore {
  readonly #items = new Map<string, StoredPicture>();
  #next = 1;

  /** Keep a picture. The result is its ID. When the store is full, the store deletes the oldest picture. */
  put(bytes: Uint8Array<ArrayBuffer>, mime: string): string {
    const id = `p${String(this.#next++)}`;
    this.#items.set(id, { bytes, mime });
    for (const old of this.#items.keys()) {
      if (this.#items.size <= PICTURES_MAX) break;
      this.#items.delete(old);
    }
    return id;
  }

  get(id: string): StoredPicture | null {
    return this.#items.get(id) ?? null;
  }
}
