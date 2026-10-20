// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the frame key and of SHA-256. Each input of the key changes it. Equal inputs give equal keys. The key
 * order of an object does not change it.
 */
import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { frameKey, isFrameKey, stableJson, takeKeyOf, viewKeyOf, type FrameKeyInput } from "../src/frameKey";
import { sha256Hex } from "../src/sha256";

const BASE: FrameKeyInput = {
  source: "take:greet",
  events: [{ at: 1000, kind: "act", member: "bo", action: "wave_hello" }],
  timeMs: 9000,
  view: "chest",
  tunes: { "pose.maskHand.side": 0.09 },
  renderer: { debug: ["ik"], assets: true },
  tier: "high",
  contentHash: "0123456789abcdef0123456789abcdef",
};

describe("sha256Hex", () => {
  test("equals the SHA-256 of node:crypto at each block edge", () => {
    for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 128, 1000, 70_000]) {
      const bytes = new Uint8Array(length).map((_, index) => (index * 31 + 7) & 255);
      expect(sha256Hex(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("é")).toBe(createHash("sha256").update("é").digest("hex"));
  });
});

describe("frameKey", () => {
  test("is 32 hex characters, and equal inputs give equal keys", () => {
    const key = frameKey(BASE);
    expect(isFrameKey(key)).toBe(true);
    expect(frameKey(structuredClone(BASE))).toBe(key);
  });

  const changes: [string, Partial<FrameKeyInput>][] = [
    ["the take", { source: "take:storm" }],
    ["a track in place of the take", { source: "track:t01_demo_tour" }],
    ["an event", { events: [{ at: 1000, kind: "act", member: "bo", action: "wave_goodbye" }] }],
    ["the order of the events", { events: [{}, ...BASE.events] }],
    ["the time", { timeMs: 9100 }],
    ["the view", { view: "overview" }],
    ["a free view", { view: [1, 2, 3, 0, 1, 0, 45] }],
    ["the pane views", { view: { panes: ["chest", "overview"], layout: "2x1" } }],
    ["a tune value", { tunes: { "pose.maskHand.side": 0.1 } }],
    ["a renderer option", { renderer: { debug: ["ik", "paths"], assets: true } }],
    ["the assets option", { renderer: { debug: ["ik"], assets: false } }],
    ["the tier", { tier: "low" }],
    ["the backend", { backend: "webgpu" }],
    ["the content hash", { contentHash: "f".repeat(32) }],
  ];
  for (const [name, change] of changes) {
    test(`changes with ${name}`, () => {
      expect(frameKey({ ...BASE, ...change })).not.toBe(frameKey(BASE));
    });
  }

  test("does not change with the key order of an object, -0, an absent field or a time inside one ms", () => {
    const reordered: FrameKeyInput = {
      contentHash: BASE.contentHash,
      tier: "high",
      renderer: { assets: true, debug: ["ik"] },
      tunes: { "pose.maskHand.side": 0.09 },
      view: "chest",
      timeMs: 9000.2,
      events: [{ action: "wave_hello", member: "bo", kind: "act", at: 1000 }],
      source: "take:greet",
    };
    expect(frameKey(reordered)).toBe(frameKey(BASE));
    expect(frameKey({ ...BASE, backend: "webgl" })).toBe(frameKey(BASE));
    expect(frameKey({ ...BASE, renderer: { ...BASE.renderer, fog: undefined } })).toBe(frameKey(BASE));
    expect(frameKey({ ...BASE, view: [0, -0, 1] })).toBe(frameKey({ ...BASE, view: [0, 0, 1] }));
  });

  test("stableJson sorts the keys at each depth and keeps the order of arrays", () => {
    expect(stableJson({ b: 1, a: { d: [3, 1], c: null } })).toBe('{"a":{"c":null,"d":[3,1]},"b":1}');
    expect(stableJson([undefined, Number.NaN])).toBe("[null,null]");
  });

  test("the take key leaves out the time, the view and the content hash; the view key is a file name", () => {
    const take = takeKeyOf(BASE);
    expect(take).toMatch(/^[0-9a-f]{16}$/);
    expect(takeKeyOf({ ...BASE, timeMs: 0, view: "top", contentHash: "e".repeat(32) })).toBe(take);
    expect(takeKeyOf({ ...BASE, tier: "low" })).not.toBe(take);
    expect(viewKeyOf("chest")).toBe("chest");
    expect(viewKeyOf([1, 2, 3, 0, 0, 0, 50])).toMatch(/^[0-9a-f]{8}$/);
    expect(viewKeyOf("../etc")).toMatch(/^[0-9a-f]{8}$/);
  });
});
