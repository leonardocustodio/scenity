// SPDX-License-Identifier: Apache-2.0
/**
 * The readers of the frame index: the frames of a take of the current content hash, the stale frames of the newest
 * older hash, the search by time and the metric record.
 */
import { describe, expect, test } from "bun:test";
import type { FrameKeyInput } from "../src/frameKey";
import { metricsList, metricsRecord, takeIndexOf, TakeFrames } from "../src/indexRead";
import { IndexStore, type IndexBackend } from "../src/indexStore";

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

const OLD = "a".repeat(32);
const NEW = "b".repeat(32);
const OTHER = "c".repeat(32);

function input(contentHash: string, timeMs: number, source = "take:greet"): FrameKeyInput {
  return {
    source,
    events: [],
    timeMs,
    view: "chest",
    tunes: {},
    renderer: { assets: true },
    tier: "high",
    contentHash,
  };
}

async function storeWith(...frames: [string, number, string?][]): Promise<IndexStore> {
  let clock = 0;
  const store = new IndexStore(memoryBackend(), { now: () => ++clock, flushDelayMs: 0 });
  for (const [hash, time, source] of frames) {
    await store.put({
      input: input(hash, time, source),
      size: 160,
      mime: "image/webp",
      bytes: new Uint8Array([time % 256]),
    });
  }
  return store;
}

describe("takeIndexOf", () => {
  test("gives the frames of now and the newest stale frames of the same take", async () => {
    const store = await storeWith([OTHER, 0], [OLD, 0], [OLD, 1000], [NEW, 0]);
    const take = (await store.manifest(input(NEW, 0)))?.take ?? "";
    const index = await takeIndexOf(store, NEW, take);
    expect(index.current?.frames.map((frame) => frame.timeMs)).toEqual([0]);
    // OLD was used after OTHER, so OLD is the newest stale hash.
    expect(index.stale?.contentHash).toBe(OLD);
    expect(index.stale?.frames.map((frame) => frame.timeMs)).toEqual([0, 1000]);
  });

  test("a take of another source has no stale frames", async () => {
    const store = await storeWith([OLD, 0, "take:storm"], [NEW, 0]);
    const take = (await store.manifest(input(NEW, 0)))?.take ?? "";
    expect((await takeIndexOf(store, NEW, take)).stale).toBeNull();
  });

  test("a take with no frame of now gives only the stale frames", async () => {
    const store = await storeWith([OLD, 0]);
    const take = (await store.manifest(input(OLD, 0)))?.take ?? "";
    const index = await takeIndexOf(store, NEW, take);
    expect(index.current).toBeNull();
    expect(index.stale?.frames).toHaveLength(1);
  });
});

describe("TakeFrames", () => {
  test("the frames of now win over the stale frames of the same slot", async () => {
    const store = await storeWith([OLD, 0], [OLD, 1000], [NEW, 0]);
    const take = (await store.manifest(input(NEW, 0)))?.take ?? "";
    const frames = new TakeFrames(await takeIndexOf(store, NEW, take));
    expect(frames.size).toBe(2);
    expect(frames.staleCount).toBe(1);
    expect(frames.at(0, "chest", 160)?.stale).toBe(false);
    expect(frames.at(1000, "chest", 160)?.stale).toBe(true);
    expect(frames.at(0, "top", 160)).toBeNull();
  });

  test("nearest finds the closest time within the gap", async () => {
    const store = await storeWith([NEW, 0], [NEW, 100], [NEW, 300]);
    const take = (await store.manifest(input(NEW, 0)))?.take ?? "";
    const frames = new TakeFrames(await takeIndexOf(store, NEW, take));
    expect(frames.nearest(140, "chest", 160, 50)?.frame.timeMs).toBe(100);
    expect(frames.nearest(260, "chest", 160, 50)?.frame.timeMs).toBe(300);
    expect(frames.nearest(200, "chest", 160, 50)).toBeNull();
    expect(frames.nearest(5000, "chest", 160, 10_000)?.frame.timeMs).toBe(300);
  });
});

describe("the metric record of the index", () => {
  test("a round trip keeps the member, the metric, the unit and the value", () => {
    const values = [
      { metric: "ik.reachError", member: "ada", value: 0.012, unit: "m" },
      { metric: "hands.toTargets", member: null, value: 0.2, unit: "m" },
      { metric: "joints.elbow", member: "bo", value: Number.NaN, unit: "deg" },
    ];
    const record = metricsRecord(values);
    expect(record).toEqual({ "ada|ik.reachError|m": 0.012, "scene|hands.toTargets|m": 0.2 });
    expect(metricsList(record)).toEqual([
      { member: "ada", metric: "ik.reachError", value: 0.012, unit: "m" },
      { member: "scene", metric: "hands.toTargets", value: 0.2, unit: "m" },
    ]);
    expect(metricsList(null)).toEqual([]);
  });
});
