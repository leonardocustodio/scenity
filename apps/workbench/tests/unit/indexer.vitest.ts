// SPDX-License-Identifier: Apache-2.0
/**
 * The indexer window of the labs app. The pacer: a frame cap, a yield to the main window, a pause on battery. The URL
 * of the lab frame for the scene options of a job. The loop with a fake host, frame and shell: a job drawn and stored,
 * a reload only for new scene options, the sleep of an empty queue, and the state "working" for the shell.
 */
import type { FrameKeyInput } from "@scenity/labs-platform/frameKey";
import type { IndexJobWire } from "@scenity/workbench-host/protocol";
import { describe, expect, test } from "vitest";
import { frameUrl, specKey, specOf } from "../../src/indexer/frameSpec";
import { IndexerLoop, NOT_READY_MS, REBUILD_WAIT_MS, type IndexerParts } from "../../src/indexer/indexerLoop";
import { mainMisses, Pacer, worseThan, type ShellState } from "../../src/indexer/pacer";

const AC: ShellState = { run: true, reason: null, main: null, report: 0 };

describe("the pacer", () => {
  const report = (n: number, fps: number, p95: number): ShellState => ({
    ...AC,
    main: { frames: Math.round(fps), p95Ms: p95, fps },
    report: n,
  });

  test("caps the draws per second when the main window draws nothing", () => {
    const pacer = new Pacer({ capFps: 20 });
    expect(pacer.next(AC, 0)).toEqual({ waitMs: 0, why: "draw" });
    pacer.drew(0);
    expect(pacer.next(AC, 10)).toEqual({ waitMs: 40, why: "cap" });
    expect(pacer.next(AC, 50).why).toBe("draw");
  });

  test("yields for a second and halves its rate when its draws slow the main window; raises it after good reports", () => {
    const pacer = new Pacer({ capFps: 32, floorFps: 2, stepFps: 4 });
    // A second without a draw of the indexer: the baseline of the main window (60 fps).
    expect(pacer.next(report(1, 60, 16.9), 0).why).toBe("draw");
    expect(pacer.baseline?.fps).toBe(60);
    pacer.drew(0);
    // The indexer drew, and the main window fell to 52 fps: a yield.
    expect(pacer.next(report(2, 52, 21), 1000)).toEqual({ waitMs: 1000, why: "yield" });
    expect(pacer.rate).toBe(16);
    // The same report counts once.
    expect(pacer.next(report(2, 52, 21), 2000).why).toBe("draw");
    pacer.drew(2000);
    pacer.next(report(3, 51, 22), 2100);
    expect(pacer.rate).toBe(8);
    pacer.drew(3200);
    pacer.next(report(4, 60, 16.9), 4000);
    expect(pacer.rate).toBe(12);
    expect(pacer.yields).toBe(2);
    // A main window that sends no more reports gives the full cap.
    pacer.next(AC, 5000);
    expect(pacer.rate).toBe(32);
  });

  test("a main window that is slow without the indexer does not stop the index", () => {
    const pacer = new Pacer({ capFps: 30 });
    // The main window draws 12 fps on a loaded machine, also in a second without a draw of the indexer.
    pacer.next(report(1, 12, 90), 0);
    pacer.drew(10);
    expect(pacer.next(report(2, 11, 91), 1000).why).not.toBe("yield");
    pacer.drew(1010);
    expect(pacer.next({ ...AC, main: { frames: 20, p95Ms: 200, fps: 6 }, report: 3 }, 2000).why).toBe("yield");
  });

  test("a report with few frames is a main window that draws nothing; a paused shell waits", () => {
    expect(mainMisses({ frames: 3, p95Ms: 40, fps: 3 })).toBe(false);
    expect(mainMisses({ frames: 60, p95Ms: 17.4, fps: 59 })).toBe(false);
    expect(mainMisses({ frames: 60, p95Ms: 17.6, fps: 59 })).toBe(true);
    expect(mainMisses({ frames: 50, p95Ms: 17, fps: 50 })).toBe(true);
    expect(worseThan({ frames: 50, p95Ms: 17, fps: 50 }, null)).toBe(true);
    expect(worseThan({ frames: 50, p95Ms: 17, fps: 50 }, { frames: 52, p95Ms: 17, fps: 52 })).toBe(false);
    const pacer = new Pacer();
    expect(pacer.next({ run: false, reason: "battery", main: null, report: 0 }, 0)).toEqual({
      waitMs: 5000,
      why: "paused",
    });
  });
});

function input(change: Partial<FrameKeyInput> = {}): FrameKeyInput {
  return {
    source: "take:greet",
    events: [],
    timeMs: 3000,
    view: "overview",
    tunes: {},
    renderer: { debug: [], assets: true, reduced: false },
    tier: "high",
    backend: "webgl",
    contentHash: "0123456789abcdef0123456789abcdef",
    ...change,
  };
}

const BASE = "http://127.0.0.1:5199/?workbench=tauri%3A%2F%2Flocalhost&worker=1&panel=0&dock=0&adaptive=0&paused=1&t=0";

describe("the frame of a job", () => {
  test("the URL carries the scene options of the job; the time, the view and the events need no reload", () => {
    const url = new URL(frameUrl(BASE, specOf(input())));
    expect(url.searchParams.get("tier")).toBe("high");
    expect(url.searchParams.get("backend")).toBe("webgl");
    expect(url.searchParams.has("debug")).toBe(false);
    expect(url.searchParams.get("panel")).toBe("0");
    const other = input({ timeMs: 9000, view: "chest", events: [{ at: 1 }] });
    expect(specKey(specOf(other))).toBe(specKey(specOf(input())));
    const options = input({
      source: "track:case-1",
      tunes: { "npc.reach": 0.4 },
      renderer: { debug: ["paths", "ik"], assets: false, reduced: true },
      tier: "low",
    });
    const params = new URL(frameUrl(BASE, specOf(options))).searchParams;
    expect(
      Object.fromEntries(["tier", "debug", "assets", "motion", "tune", "source"].map((n) => [n, params.get(n)])),
    ).toEqual({
      tier: "low",
      debug: "ik,paths",
      assets: "0",
      motion: "reduced",
      tune: "npc.reach:0.4",
      source: "track:case-1",
    });
  });
});

/** A fake world of the loop: a host queue, a frame and a shell. */
function world(jobs: IndexJobWire[]) {
  const log: string[] = [];
  const working: boolean[] = [];
  const slept: number[] = [];
  let clock = 0;
  const parts: IndexerParts = {
    request: (type: string, params: Record<string, unknown>) => {
      log.push(type);
      if (type === "index.next") return Promise.resolve({ jobs: jobs.splice(0, 1) });
      if (type === "index.done") log.push(`done ${String(params.job)} ${String(params.bytes)}`);
      if (type === "index.fail") log.push(`fail ${String(params.job)}`);
      return Promise.resolve({ stored: true });
    },
    sendIndexFrame: (job, mime, bytes) => log.push(`frame ${String(job)} ${mime} ${String(bytes.byteLength)}`),
    callFrame: (call, args) => {
      log.push(call);
      const [job] = args as [FrameKeyInput];
      if (job.view === "broken") return Promise.reject(new Error("The job has other scene options than the page."));
      if (job.view === "fog") return Promise.reject(new Error("The scene of the page is not ready."));
      return Promise.resolve({ mime: "image/jpeg", bytes: new ArrayBuffer(5), metrics: { reach: 1 } });
    },
    baseUrl: () => BASE,
    load: (url) => {
      log.push(`load ${new URL(url).searchParams.get("tier") ?? ""}`);
      return Promise.resolve();
    },
    shellState: (value) => {
      working.push(value);
      return Promise.resolve(AC);
    },
    waitForWork: () => {
      log.push("wait");
      return Promise.resolve();
    },
    sleep: (ms) => {
      slept.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    now: () => (clock += 1),
  };
  return { parts, log, working, slept };
}

function job(id: number, change: Partial<FrameKeyInput> = {}): IndexJobWire {
  return { job: id, key: "f".repeat(32), size: 160, input: input(change) };
}

describe("the loop", () => {
  test("draws a job, sends its frame and `index.done`, and loads the frame only for new scene options", async () => {
    const { parts, log, working } = world([job(1), job(2, { timeMs: 4000 }), job(3, { tier: "low" })]);
    const loop = new IndexerLoop(parts, { capFps: 1000 });
    for (let step = 0; step < 4; step += 1) await loop.step();
    expect(log.filter((line) => line.startsWith("load"))).toEqual(["load high", "load low"]);
    expect(log.filter((line) => line.startsWith("frame"))).toEqual([
      "frame 1 image/jpeg 5",
      "frame 2 image/jpeg 5",
      "frame 3 image/jpeg 5",
    ]);
    expect(log).toContain("done 3 5");
    expect(log.at(-1)).toBe("wait");
    expect(loop.status).toMatchObject({ phase: "idle", done: 3, failed: 0 });
    // The shell hears "working" after the first job and "idle" after the empty queue.
    expect(working).toEqual([false, true, true, true]);
  });

  test("gives a refused job back and loads the frame again (a new build of the lab)", async () => {
    const { parts, log } = world([job(4, { view: "broken" }), job(5)]);
    const loop = new IndexerLoop(parts, { capFps: 1000 });
    await loop.step();
    await loop.step();
    expect(log).toContain("fail 4");
    expect(log.filter((line) => line.startsWith("load"))).toEqual(["load high", "load high"]);
    expect(loop.status).toMatchObject({ done: 1, failed: 1 });
  });

  test("waits a moment after a frame whose scene is not ready, so the host does not drop the job", async () => {
    const { parts, log, slept } = world([job(7, { view: "fog" }), job(8, { view: "broken" })]);
    const loop = new IndexerLoop(parts, { capFps: 1000 });
    await loop.step();
    expect(log).toContain("fail 7");
    expect(slept.at(-1)).toBe(NOT_READY_MS);
    const before = slept.length;
    await loop.step();
    // A refusal for the scene options waits for a new build of the lab, then loads the frame again.
    expect(slept.slice(before)).toContain(REBUILD_WAIT_MS);
    expect(slept.slice(before)).not.toContain(NOT_READY_MS);
  });

  test("loads the frame again for a job of a new content hash (a new build of the lab at the same URL)", async () => {
    const { parts, log } = world([
      job(9),
      job(10, { contentHash: "f".repeat(32) }),
      job(11, { contentHash: "f".repeat(32) }),
    ]);
    const loop = new IndexerLoop(parts, { capFps: 1000 });
    for (let step = 0; step < 3; step += 1) await loop.step();
    expect(log.filter((line) => line.startsWith("load"))).toEqual(["load high", "load high"]);
    expect(loop.status).toMatchObject({ done: 3, failed: 0 });
  });

  test("keeps the last frame pace of the main window in its status", async () => {
    const { parts } = world([job(12)]);
    const main = { frames: 60, p95Ms: 16.9, fps: 60 };
    const loop = new IndexerLoop({ ...parts, shellState: () => Promise.resolve({ ...AC, main, report: 1 }) });
    await loop.step();
    expect(loop.status.main).toEqual(main);
  });

  test("waits for the built lab of the host", async () => {
    const { parts, log } = world([job(6)]);
    const loop = new IndexerLoop({ ...parts, baseUrl: () => null });
    await loop.step();
    expect(log).toEqual(["wait"]);
    expect(loop.status.phase).toBe("no-lab");
  });
});
