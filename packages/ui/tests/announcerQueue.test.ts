// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { AnnouncerQueue, type Announcement } from "../src/a11y/announcerQueue";

/** A fake clock and timer: `advance` runs the scheduled functions whose time came. */
function fakeTime() {
  let now = 0;
  let timers: { at: number; run: () => void; id: number }[] = [];
  let nextId = 1;
  return {
    now: () => now,
    schedule: (run: () => void, delay: number) => {
      const id = nextId++;
      timers.push({ at: now + delay, run, id });
      return () => {
        timers = timers.filter((t) => t.id !== id);
      };
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        timers = timers.filter((t) => t !== due);
        now = due.at;
        due.run();
      }
      now = end;
    },
  };
}

function setup(minIntervalMs = 2000, ttlMs = 10_000) {
  const time = fakeTime();
  const out: Announcement[] = [];
  const queue = new AnnouncerQueue((a) => out.push(a), {
    minIntervalMs,
    ttlMs,
    now: time.now,
    schedule: time.schedule,
  });
  return { time, out, queue };
}

describe("AnnouncerQueue", () => {
  test("announces the first item at once and keeps the minimum interval", () => {
    const { time, out, queue } = setup();
    queue.announce("one");
    queue.announce("two");
    expect(out.map((a) => a.text)).toEqual(["one"]);
    time.advance(1999);
    expect(out).toHaveLength(1);
    time.advance(1);
    expect(out.map((a) => a.text)).toEqual(["one", "two"]);
  });

  test("assertive items go before polite items", () => {
    const { time, out, queue } = setup();
    queue.announce("first");
    queue.announce("polite line");
    queue.announce("High alarm", { politeness: "assertive" });
    time.advance(4000);
    expect(out.map((a) => a.text)).toEqual(["first", "High alarm", "polite line"]);
    expect(out[1]?.politeness).toBe("assertive");
  });

  test("an item with a key replaces the waiting item with the same key", () => {
    const { time, out, queue } = setup();
    queue.announce("start");
    queue.announce("Order 8: heard", { key: "order:8" });
    queue.announce("Order 8: in progress", { key: "order:8" });
    queue.announce("Order 9: heard", { key: "order:9" });
    expect(queue.size).toBe(2);
    time.advance(10_000);
    expect(out.map((a) => a.text)).toEqual(["start", "Order 8: in progress", "Order 9: heard"]);
  });

  test("drops stale items and ignores empty text", () => {
    const { time, out, queue } = setup(2000, 3000);
    queue.announce("now");
    queue.announce("   ");
    queue.announce("a");
    queue.announce("b");
    queue.announce("c");
    time.advance(10_000);
    // "a" comes at 2 s; "b" at 4 s is older than its 3 s time to live, and so is "c".
    expect(out.map((a) => a.text)).toEqual(["now", "a"]);
  });

  test("clear removes the waiting items", () => {
    const { time, out, queue } = setup();
    queue.announce("one");
    queue.announce("two");
    queue.clear();
    time.advance(5000);
    expect(out.map((a) => a.text)).toEqual(["one"]);
  });
});
