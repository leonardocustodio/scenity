// SPDX-License-Identifier: Apache-2.0
/**
 * The idle runner of the frame index: one job per idle slot with at least 4 ms left, a pause while the page is hidden
 * or draws below 55 fps, a new check after an idle step, and the stop. A fake host gives the idle slots, the timers
 * and the clock.
 */
import { describe, expect, test } from "bun:test";
import { FpsMeter, startIdleRunner, type IdleHost, type StepResult } from "../src/idle";

interface FakeHost extends IdleHost {
  /** Run the waiting idle callback with this time left; false when none waits. */
  idle(remaining: number): boolean;
  /** Run the waiting timers. */
  timers(): number;
  frame(time: number): void;
  visibility: string;
  now: number;
}

function fakeHost(): FakeHost {
  let idle: ((deadline: { timeRemaining(): number }) => void) | null = null;
  const timers = new Map<number, () => void>();
  const frames: ((time: number) => void)[] = [];
  let next = 1;
  const host: FakeHost = {
    visibility: "visible",
    now: 0,
    get document() {
      return { visibilityState: host.visibility };
    },
    performance: { now: () => host.now },
    requestIdleCallback(callback) {
      idle = callback;
      return next++;
    },
    cancelIdleCallback() {
      idle = null;
    },
    requestAnimationFrame(callback) {
      frames.push(callback);
      return next++;
    },
    cancelAnimationFrame() {
      frames.length = 0;
    },
    setTimeout(callback) {
      const id = next++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
    idle(remaining) {
      const run = idle;
      idle = null;
      if (run === null) return false;
      run({ timeRemaining: () => remaining });
      return true;
    },
    timers() {
      const list = [...timers.values()];
      timers.clear();
      for (const run of list) run();
      return list.length;
    },
    frame(time) {
      const list = frames.splice(0);
      for (const run of list) run(time);
    },
  };
  return host;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("startIdleRunner", () => {
  test("runs one step per idle slot, only with at least 4 ms left", async () => {
    const host = fakeHost();
    let steps = 0;
    const runner = startIdleRunner({
      host,
      fps: () => 60,
      step: () => {
        steps += 1;
        host.now += 1.5;
        return Promise.resolve<StepResult>("more");
      },
    });
    host.idle(2);
    await flush();
    expect(steps).toBe(0);
    host.idle(10);
    await flush();
    host.idle(10);
    await flush();
    expect(steps).toBe(2);
    expect(runner.jobs()).toBe(2);
    expect(runner.slotTimes()).toEqual([1.5, 1.5]);
    runner.stop();
    expect(runner.state()).toBe("stopped");
    expect(host.idle(10)).toBe(false);
  });

  test("pauses while the page is hidden or draws below 55 fps", async () => {
    const host = fakeHost();
    let fps = 40;
    let steps = 0;
    const states: string[] = [];
    const runner = startIdleRunner({
      host,
      fps: () => fps,
      onState: (state) => states.push(state),
      step: () => {
        steps += 1;
        return Promise.resolve<StepResult>("more");
      },
    });
    host.idle(10);
    await flush();
    expect(steps).toBe(0);
    expect(runner.state()).toBe("slow");
    fps = 60;
    host.visibility = "hidden";
    host.timers();
    host.idle(10);
    await flush();
    expect(runner.state()).toBe("hidden");
    host.visibility = "visible";
    host.timers();
    host.idle(10);
    await flush();
    expect(steps).toBe(1);
    expect(states).toEqual(["slow", "hidden", "running"]);
    runner.stop();
  });

  test("an idle step waits, a wake looks again at once, and a done step stops", async () => {
    const host = fakeHost();
    const answers: StepResult[] = ["idle", "done"];
    const runner = startIdleRunner({ host, fps: () => null, step: () => Promise.resolve(answers.shift() ?? "idle") });
    host.idle(10);
    await flush();
    expect(runner.state()).toBe("idle");
    expect(host.idle(10)).toBe(false);
    runner.wake();
    host.idle(10);
    await flush();
    expect(runner.state()).toBe("stopped");
  });
});

describe("FpsMeter", () => {
  test("gives the rate of the animation frames of the last second", () => {
    const host = fakeHost();
    const meter = new FpsMeter(host);
    meter.start();
    for (let index = 0; index <= 60; index += 1) host.frame(index * 20);
    expect(Math.round(meter.fps() ?? 0)).toBe(50);
    meter.stop();
    expect(meter.fps()).toBeNull();
  });
});
