// SPDX-License-Identifier: Apache-2.0
/**
 * The shared suite of the frame index stores on a backend in memory: the core of both stores. The host
 * (files) and the lab page alone (OPFS, IndexedDB) run the same suite on their own backends.
 */
import { describe, expect, test } from "bun:test";
import { IndexStore, stepOf, type IndexBackend } from "../src/indexStore";
import { indexStoreSuite } from "../src/testing/indexStoreSuite";

/** A backend in memory; `files` survives a new store (a restart). */
function memoryBackend(files = new Map<string, Uint8Array>()): IndexBackend {
  const under = (path: string) => [...files.keys()].filter((name) => name.startsWith(`${path}/`));
  return {
    read: (path) => Promise.resolve(files.get(path)?.slice() ?? null),
    write: (path, bytes) => {
      files.set(path, bytes.slice());
      return Promise.resolve();
    },
    remove: (path) => {
      files.delete(path);
      return Promise.resolve();
    },
    removeTree: (path) => {
      for (const name of under(path)) files.delete(name);
      return Promise.resolve();
    },
    list: (path) => Promise.resolve(under(path)),
  };
}

indexStoreSuite("memory", { describe, test, expect }, (options) => {
  const files = new Map<string, Uint8Array>();
  return Promise.resolve({
    store: new IndexStore(memoryBackend(files), options),
    reopen: () => new IndexStore(memoryBackend(files), options),
  });
});

describe("stepOf", () => {
  test("a whole second, a step of 100 ms, a free time", () => {
    expect([stepOf(3000), stepOf(3100), stepOf(3150), stepOf(0)]).toEqual([1000, 100, 1, 1000]);
  });
});
