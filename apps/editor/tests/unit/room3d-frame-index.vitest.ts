// SPDX-License-Identifier: Apache-2.0
/**
 * The frame index of the lab page alone: the shared suite of the stores on OPFS and on IndexedDB (fakes under
 * happy-dom), the choice of the backend, and the 200 MB limit.
 */
import { describe, expect, it, test } from "vitest";
import { BROWSER_INDEX_LIMIT } from "@scenity/labs-platform/indexStore";
import { indexStoreSuite, sampleInput } from "@scenity/labs-platform/testing/indexStore";
import { idbBackend, openIndexDb, opfsBackend } from "../../src/core/index/backends";
import { IndexStore } from "@scenity/labs-platform/indexStore";
import { openBrowserIndex } from "../../src/core/index/browserIndex";
import { fakeIndexedDb, fakeOpfs, type Tree } from "./indexFakes";

indexStoreSuite("OPFS", { describe, test, expect }, (options) => {
  const tree: Tree = new Map();
  return Promise.resolve({
    store: new IndexStore(opfsBackend(fakeOpfs(tree)), options),
    reopen: () => new IndexStore(opfsBackend(fakeOpfs(tree)), options),
  });
});

indexStoreSuite("IndexedDB", { describe, test, expect }, async (options) => {
  const data = new Map<string, Map<string, unknown>>();
  const db = await openIndexDb(fakeIndexedDb(data), "test");
  const again = await openIndexDb(fakeIndexedDb(data), "test");
  return {
    store: new IndexStore(idbBackend(db), options),
    reopen: () => new IndexStore(idbBackend(again), options),
  };
});

describe("the store of the lab page alone", () => {
  it("uses OPFS when it exists, IndexedDB when it does not, and nothing without both", async () => {
    const opfs = await openBrowserIndex({
      navigator: { storage: { getDirectory: () => Promise.resolve(fakeOpfs()) } },
      indexedDB: fakeIndexedDb(),
    });
    expect(opfs?.kind).toBe("opfs");
    const idb = await openBrowserIndex({ navigator: {}, indexedDB: fakeIndexedDb() });
    expect(idb?.kind).toBe("indexeddb");
    const broken = await openBrowserIndex({
      navigator: { storage: { getDirectory: () => Promise.reject(new Error("SecurityError")) } },
      indexedDB: fakeIndexedDb(),
    });
    expect(broken?.kind).toBe("indexeddb");
    expect(await openBrowserIndex({})).toBeNull();
  });

  it("keeps at most 200 MB: a put above the limit trims the old content hash", async () => {
    expect(BROWSER_INDEX_LIMIT).toBe(200 * 1024 * 1024);
    const opened = await openBrowserIndex({ navigator: {}, indexedDB: fakeIndexedDb() }, { limitBytes: 100 });
    const store = opened!.store;
    await store.put({ input: sampleInput(0), size: 160, mime: "image/jpeg", bytes: new Uint8Array(80) });
    await store.put({
      input: sampleInput(0, { contentHash: "d".repeat(32) }),
      size: 160,
      mime: "image/jpeg",
      bytes: new Uint8Array(80),
    });
    expect((await store.contents()).map((use) => use.contentHash)).toEqual(["d".repeat(32)]);
  });
});
