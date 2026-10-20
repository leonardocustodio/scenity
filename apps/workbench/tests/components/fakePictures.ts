// SPDX-License-Identifier: Apache-2.0
/**
 * A fake picture source for the component tests. Each picture ID gives the object URL `blob:picture-<id>`. The fake
 * counts the acquire calls and the release calls.
 */
import { setPictureSource, type PictureSource } from "../../src/host/pictures";

export interface FakePictures extends PictureSource {
  readonly held: Map<string, number>;
  stop(): void;
}

/** A picture ID of 32 hex characters from a short label. */
export function pictureIdOf(label: string): string {
  return Array.from(label, (char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("")
    .padEnd(32, "0")
    .slice(0, 32);
}

/** Set a fake source for the page; `stop` removes it. */
export function fakePictures(): FakePictures {
  const held = new Map<string, number>();
  const source: FakePictures = {
    held,
    acquire(id) {
      held.set(id, (held.get(id) ?? 0) + 1);
      return Promise.resolve(`blob:picture-${id}`);
    },
    release(id) {
      const count = (held.get(id) ?? 0) - 1;
      if (count <= 0) held.delete(id);
      else held.set(id, count);
    },
    stop() {
      setPictureSource(null);
    },
  };
  setPictureSource(source);
  return source;
}
