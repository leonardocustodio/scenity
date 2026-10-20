// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { AssetDatabase } from "../src/database";
import type { AssetWatcher } from "../src/watch";
import { putAsset, removeTemps, tempProject } from "./helpers";

const A = "01J9Z6Q3R9AAAAAAAAAAAAAAAA";
const B = "01J9Z6Q3R9BBBBBBBBBBBBBBBB";
let watcher: AssetWatcher | undefined;

afterEach(() => {
  watcher?.close();
  watcher = undefined;
  removeTemps();
});

/** The first callback of the watcher, or an error after the timeout. */
function nextChange(db: AssetDatabase, timeoutMs = 5000): Promise<readonly string[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("the watcher did not call back"));
    }, timeoutMs);
    watcher = db.watch(
      (ids) => {
        clearTimeout(timer);
        resolve(ids);
      },
      { debounceMs: 30, onError: reject },
    );
  });
}

describe("the watcher of the asset database", () => {
  test("the watcher sees a new record and updates the index", async () => {
    const dir = tempProject([A, B]);
    putAsset(dir, "assets/a.glb", A);
    const db = await AssetDatabase.open(dir);
    expect(db.missing()).toHaveLength(1);
    const change = nextChange(db);
    await Bun.sleep(50);
    putAsset(dir, "assets/sub/b.glb", B);
    expect(await change).toEqual([B]);
    expect(db.get(B)?.sourcePath).toBe("assets/sub/b.glb");
    expect(db.missing()).toEqual([]);
  });
});
