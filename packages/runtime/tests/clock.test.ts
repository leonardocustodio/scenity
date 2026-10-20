// SPDX-License-Identifier: Apache-2.0
// The clock of the render workers.
import { describe, expect, it } from "bun:test";
import { AnchorClock, AnchorSampler, JUMP_BACK_MS, MAX_EXTRAPOLATION_MS, workerScheduler } from "../src";

describe("AnchorClock", () => {
  it("extrapolates from the anchor at the time scale while the session runs", () => {
    const clock = new AnchorClock();
    expect(clock.read(1000)).toBeNull();
    clock.set({ simMs: 10_000, wallMs: 1000, scale: 2, running: true });
    expect(clock.read(1000)).toBe(10_000);
    expect(clock.read(1100)).toBe(10_200);
  });

  it("stops at the extrapolation limit and during a pause", () => {
    const clock = new AnchorClock();
    clock.set({ simMs: 5000, wallMs: 0, scale: 1, running: true });
    expect(clock.read(5000)).toBe(5000 + MAX_EXTRAPOLATION_MS);
    clock.set({ simMs: 6000, wallMs: 6000, scale: 0, running: false });
    expect(clock.read(9000)).toBe(6000);
  });

  it("never steps back by a small step, but follows a real jump back", () => {
    const clock = new AnchorClock();
    clock.set({ simMs: 10_000, wallMs: 0, scale: 1, running: true });
    expect(clock.read(300)).toBe(10_300);
    clock.set({ simMs: 10_250, wallMs: 300, scale: 1, running: true });
    expect(clock.read(300)).toBe(10_300);
    clock.set({ simMs: 10_300 - JUMP_BACK_MS - 1, wallMs: 400, scale: 1, running: true });
    expect(clock.read(400)).toBe(10_300 - JUMP_BACK_MS - 1);
  });

  it("reads the time of a stopped clock, also a little before the time it extrapolated", () => {
    const clock = new AnchorClock();
    clock.set({ simMs: 10_000, wallMs: 0, scale: 1, running: true });
    expect(clock.read(200)).toBe(10_200);
    clock.set({ simMs: 10_150, wallMs: 210, scale: 0, running: false });
    expect(clock.read(400)).toBe(10_150);
  });

  it("follows a small step back after a seek of the page clock (a new epoch, the 3D room lab)", () => {
    const clock = new AnchorClock();
    clock.set({ simMs: 10_000, wallMs: 0, scale: 1, running: true });
    expect(clock.read(0)).toBe(10_000);
    clock.set({ simMs: 9_800, wallMs: 100, scale: 1, running: true });
    expect(clock.read(100)).toBe(10_000);
    clock.set({ simMs: 9_800, wallMs: 200, scale: 1, running: true, epoch: 1 });
    expect(clock.read(200)).toBe(9_800);
  });
});

describe("AnchorSampler", () => {
  function sampler() {
    const wall = { value: 0 };
    return { wall, sampler: new AnchorSampler(1000, () => wall.value) };
  }

  it("starts a new window at a seek (a new epoch) and gives the epoch in the anchor", () => {
    const { wall, sampler: s } = sampler();
    for (let i = 0; i <= 5; i += 1) {
      wall.value = i * 100;
      s.sample(1000 + i * 100);
    }
    wall.value = 600;
    const seek = s.sample(1200, 1);
    expect(seek.epoch).toBe(1);
    expect(seek.simMs).toBe(1200);
    // The samples before the seek do not count: one sample is no slope yet.
    expect(seek.running).toBe(false);
    wall.value = 700;
    const next = s.sample(1300, 1);
    expect(next.running).toBe(true);
    expect(next.scale).toBe(1);
  });

  it("measures the time scale of the page clock", () => {
    const { wall, sampler: s } = sampler();
    s.sample(0);
    for (let i = 1; i <= 10; i += 1) {
      wall.value = i * 100;
      s.sample(i * 200);
    }
    const anchor = s.sample(2000);
    expect(anchor.running).toBe(false);
    wall.value = 1100;
    const next = s.sample(2200);
    expect(next.running).toBe(true);
    expect(next.scale).toBe(2);
  });

  it("detects a pause and gives the full rate at once after the resume", () => {
    const { wall, sampler: s } = sampler();
    for (let i = 0; i <= 5; i += 1) {
      wall.value = i * 100;
      s.sample(1000 + i * 100);
    }
    wall.value = 600;
    expect(s.sample(1500).running).toBe(false);
    wall.value = 700;
    expect(s.sample(1500).running).toBe(false);
    wall.value = 800;
    const resumed = s.sample(1600);
    expect(resumed.running).toBe(true);
    expect(resumed.scale).toBe(1);
  });

  it("gives no time before the first server time", () => {
    const { sampler: s } = sampler();
    expect(s.sample(null)).toMatchObject({ simMs: null, running: false });
  });
});

describe("workerScheduler", () => {
  it("uses requestAnimationFrame of the scope when it has one", () => {
    const calls: string[] = [];
    const scheduler = workerScheduler({
      requestAnimationFrame: (callback) => {
        calls.push("request");
        callback(0);
        return 7;
      },
      cancelAnimationFrame: (handle) => calls.push(`cancel ${String(handle)}`),
    });
    let ran = false;
    expect(scheduler.request(() => (ran = true))).toBe(7);
    scheduler.cancel(7);
    expect(ran).toBe(true);
    expect(calls).toEqual(["request", "cancel 7"]);
  });

  it("falls back to a 60 Hz timer", async () => {
    const scheduler = workerScheduler({});
    await new Promise<void>((resolve) => scheduler.request(resolve));
  });
});
