// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the job queue of the frame index: the order of the six ranks, a seek that moves its window first, an open
 * item, duplicate keys, a content hash change and the leases.
 */
import { describe, expect, test } from "bun:test";
import { focusOfUrl, IndexQueue, LEASE_MS, WINDOW_MS } from "../src/index/queue";
import type { IndexTakePlan } from "../src/indexProtocol";

const HASH = "a".repeat(32);
const NEW_HASH = "b".repeat(32);

function plan(source: string, change: Partial<IndexTakePlan> = {}): IndexTakePlan {
  return {
    source,
    events: [],
    tunes: {},
    renderer: { assets: true },
    tier: "high",
    durationMs: 20_000,
    moments: [9050],
    views: ["chest"],
    items: [{ id: "clip_wave_hover", from: 12_000, to: 12_500 }],
    ...change,
  };
}

/** A clock that a test moves. */
function clock(): { now: () => number; at: number } {
  const state = { at: 0, now: () => state.at };
  return state;
}

describe("the index queue", () => {
  test("the jobs of a take: 100 ms steps and the moments, at 160 and 640 px, per view", () => {
    const queue = new IndexQueue();
    const added = queue.plan([plan("take:greet", { views: ["chest", "overview"] })], HASH);
    // 201 steps of 100 ms and one moment, 2 views, 2 sizes.
    expect(added.length).toBe(202 * 2 * 2);
    expect(queue.progress()).toMatchObject({ contentHash: HASH, total: 808, queued: 808, done: 0, stale: 0 });
  });

  test("the order: window, open item, moments, the take at 1 s, at 100 ms, other takes; small sizes first", () => {
    const queue = new IndexQueue();
    queue.plan([plan("take:greet"), plan("take:storm")], HASH);
    queue.setFocus({ source: "take:greet", timeMs: 5000, item: "clip_wave_hover" });
    const order = queue
      .take(10_000)
      .map((job) => `${job.input.source}@${String(job.input.timeMs)}/${String(job.size)}`);
    const window = (2 * WINDOW_MS) / 100 + 1;
    expect(order.slice(0, 3)).toEqual(["take:greet@5000/160", "take:greet@4900/160", "take:greet@5100/160"]);
    expect(order[window]).toBe("take:greet@5000/640");
    const item = order.slice(2 * window, 2 * window + 12);
    expect(item.slice(0, 6).every((name) => /^take:greet@12[0-5]00\/160$/.test(name))).toBe(true);
    expect(item.slice(6).every((name) => /^take:greet@12[0-5]00\/640$/.test(name))).toBe(true);
    const afterItem = 2 * window + 12;
    expect(order[afterItem]).toBe("take:greet@9050/160");
    expect(order[afterItem + 2]).toBe("take:greet@0/160");
    expect(order.indexOf("take:greet@1000/640")).toBeLessThan(order.indexOf("take:greet@100/160"));
    expect(order.findIndex((name) => name.startsWith("take:storm"))).toBe(order.length / 2);
    expect(order.at(-1)).toMatch(/^take:storm@\d+\/640$/);
  });

  test("a seek moves its window to the front at once", () => {
    const queue = new IndexQueue();
    queue.plan([plan("take:greet")], HASH);
    queue.setFocus({ source: "take:greet", timeMs: 0, item: null });
    expect(queue.take(1)[0]?.input.timeMs).toBe(0);
    queue.setFocus({ timeMs: 15_000 });
    const next = queue.take(5).map((job) => job.input.timeMs);
    expect(next).toEqual([15_000, 14_900, 15_100, 14_800, 15_200]);
    for (const time of next) expect(Math.abs(time - 15_000)).toBeLessThanOrEqual(WINDOW_MS);
  });

  test("a new take in the URL (a seek of another take) brings that take first", () => {
    const queue = new IndexQueue();
    queue.plan([plan("take:greet"), plan("take:storm")], HASH);
    const focus = focusOfUrl("http://127.0.0.1:5175/?take=storm&t=7000&paused=1&item=cy");
    expect(focus).toEqual({ source: "take:storm", timeMs: 7000, item: "cy" });
    queue.setFocus(focus!);
    expect(queue.take(1)[0]?.input).toMatchObject({ source: "take:storm", timeMs: 7000 });
    expect(focusOfUrl("http://x/?source=track:t01_demo_tour&t=12.4")).toEqual({
      source: "track:t01_demo_tour",
      timeMs: 12,
      item: null,
    });
    expect(focusOfUrl("not a url")).toBeNull();
  });

  test("duplicate keys collapse: one job per key and size", () => {
    const queue = new IndexQueue();
    // The moment at 3000 is also a step; the same take twice gives the same keys.
    const added = queue.plan([plan("take:greet", { moments: [3000] }), plan("take:greet", { moments: [3000] })], HASH);
    const keys = new Set(added.map((job) => `${job.key}|${String(job.size)}`));
    expect(queue.progress().total).toBe(201 * 2);
    expect(keys.size).toBe(201 * 2);
    const moment = added.find((job) => job.input.timeMs === 3000);
    expect(moment?.moment).toBe(true);
  });

  test("a content hash change marks the old jobs stale; their answers store nothing", () => {
    const queue = new IndexQueue();
    queue.plan([plan("take:greet", { durationMs: 1000, moments: [] })], HASH);
    const [taken] = queue.take(1);
    queue.done(queue.take(1)[0]!.id);
    const added = queue.setContentHash(NEW_HASH);
    expect(queue.progress()).toMatchObject({ contentHash: NEW_HASH, stale: 21, total: 22, queued: 22 });
    expect(added.every((job) => job.input.contentHash === NEW_HASH)).toBe(true);
    expect(queue.job(taken!.id)).toBeNull();
    expect(queue.done(taken!.id)).toBe(false);
    expect(queue.setContentHash(NEW_HASH)).toEqual([]);
  });

  test("a taken job comes back after its lease; a failed job comes back, and leaves after three failures", () => {
    const time = clock();
    const queue = new IndexQueue({ now: time.now, sizes: [160] });
    queue.plan([plan("take:greet", { durationMs: 100, moments: [], items: [] })], HASH);
    const [first] = queue.take(1);
    expect(queue.take(1)[0]?.id).not.toBe(first!.id);
    time.at = LEASE_MS + 1;
    expect(queue.take(2).map((job) => job.id)).toContain(first!.id);
    for (let attempt = 0; attempt < 3; attempt += 1) queue.fail(first!.id);
    expect(queue.job(first!.id)?.state).toBe("done");
    expect(queue.take(5, [640])).toEqual([]);
  });
});
