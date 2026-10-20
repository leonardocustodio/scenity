// SPDX-License-Identifier: Apache-2.0
// The cache of the optimized models: a hit gives the bytes of a new optimize, and a build
// removes the entries that it did not use.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelCache } from "../src/build/cache";
import { optimizeModel } from "../src/build/optimize";
import { HIGH_LOD, LOW_LOD } from "../src/build/settings";
import { boxModel } from "./buildFixtures";

const folder = mkdtempSync(join(tmpdir(), "assets-cache-"));
afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

const SETTINGS = { triangles: 300, socketNames: ["grip"] };

describe("the build cache", () => {
  it("gives the bytes of a new optimize from the cache", async () => {
    const input = await boxModel({ boxes: 30, textureSize: 32, sockets: ["grip"] });
    const fresh = await optimizeModel(input, HIGH_LOD, SETTINGS);
    const first = new ModelCache(true, folder);
    const missed = await first.optimize(input, HIGH_LOD, SETTINGS);
    expect([first.hits, first.misses]).toEqual([0, 1]);
    const second = new ModelCache(true, folder);
    const hit = await second.optimize(input, HIGH_LOD, SETTINGS);
    expect([second.hits, second.misses]).toEqual([1, 0]);
    for (const built of [missed, hit]) {
      expect(Buffer.from(built.glb).equals(Buffer.from(fresh.glb))).toBe(true);
      expect(Buffer.from(built.plain).equals(Buffer.from(fresh.plain))).toBe(true);
      expect(built.stats).toEqual(fresh.stats);
    }
    expect(fresh.stats.sockets).toEqual([{ name: "grip", parent: "body" }]);
  });

  it("has another key for other optimize options", async () => {
    const input = await boxModel({ boxes: 3 });
    const cache = new ModelCache(true, folder);
    expect(cache.keyOf(input, LOW_LOD, SETTINGS)).not.toBe(cache.keyOf(input, LOW_LOD, { ...SETTINGS, triangles: 20 }));
    expect(cache.keyOf(input, LOW_LOD, SETTINGS)).not.toBe(cache.keyOf(input, HIGH_LOD, SETTINGS));
  });

  it("keeps only the entries of the last build", async () => {
    const other = await boxModel({ boxes: 31, textureSize: 32 });
    const cache = new ModelCache(true, folder);
    await cache.optimize(other, LOW_LOD, SETTINGS);
    cache.prune();
    const key = cache.keyOf(other, LOW_LOD, SETTINGS);
    expect(readdirSync(folder).sort()).toEqual([`${key}.glb`, `${key}.json`, `${key}.plain.glb`]);
  });

  it("is not used when it is off", async () => {
    const cache = new ModelCache(false, join(folder, "off"));
    await cache.optimize(await boxModel({ boxes: 30, textureSize: 32 }), LOW_LOD, SETTINGS);
    expect([cache.hits, cache.misses]).toEqual([0, 0]);
    expect(readdirSync(folder)).not.toContain("off");
  });
});
