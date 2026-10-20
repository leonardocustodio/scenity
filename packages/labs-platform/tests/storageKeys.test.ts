// SPDX-License-Identifier: Apache-2.0
/**
 * The browser storage keys. A read of a `scenity.` key that finds no value moves the value of the old `codeblue.`
 * key, once. A storage without the write parts or with a write error still gives the old value.
 */
import { describe, expect, test } from "bun:test";
import { oldStorageKey, storageItem, type StorageLike } from "../src/storageKeys";

function fakeStorage(start: Record<string, string>): StorageLike & { readonly values: Record<string, string> } {
  const map = new Map(Object.entries(start));
  return {
    get values() {
      return Object.fromEntries(map);
    },
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

describe("storageKeys", () => {
  test("the old key of a key", () => {
    expect(oldStorageKey("scenity.labs.cardsPlace")).toBe("codeblue.labs.cardsPlace");
    expect(oldStorageKey("room3d-lab.recent")).toBeNull();
  });

  test("a new key reads its own value", () => {
    const storage = fakeStorage({ "scenity.a": "1", "codeblue.a": "0" });
    expect(storageItem(storage, "scenity.a")).toBe("1");
    expect(storage.values["codeblue.a"]).toBe("0");
  });

  test("a missing new key moves the value of the old key", () => {
    const storage = fakeStorage({ "codeblue.a": "old" });
    expect(storageItem(storage, "scenity.a")).toBe("old");
    expect(storage.values).toEqual({ "scenity.a": "old" });
    expect(storageItem(storage, "scenity.b")).toBeNull();
  });

  test("a storage that cannot write still gives the old value", () => {
    const readOnly: StorageLike = { getItem: (key) => (key === "codeblue.a" ? "old" : null) };
    expect(storageItem(readOnly, "scenity.a")).toBe("old");
    const full = fakeStorage({ "codeblue.a": "old" });
    full.setItem = () => {
      throw new Error("full");
    };
    expect(storageItem(full, "scenity.a")).toBe("old");
    expect(full.values["codeblue.a"]).toBe("old");
  });
});
