// SPDX-License-Identifier: Apache-2.0
// The fallbacks of the player over fakes: the renderer plans (WebGPU to WebGL, the worker to the main thread),
// the fallback events, the error state with the poster, a failure after the first frame, and the quality ladder.
import { describe, expect, test } from "bun:test";
import type { DocumentClient, DocumentClientOptions } from "@scenity/runtime/documentClient";
import type { SceneStats } from "@scenity/runtime/protocol";
import { firstPlan, nextPlan, NO_WORKER_CANVAS, pathOf, WORKER_START } from "../src/fallback";
import { createPlayerWith } from "../src/player";
import { FIRST_FRAME_MS } from "../src/renderer";
import { GOOD_TO_STEP_UP, LADDER_WINDOW_MS, ladderTiers, ladderWindow, LADDER_START } from "../src/quality";
import type { PlayerFallback } from "../src/types";
import { emptyLog, fakeCanvas, fakeClient, fakeDeps, sampleFetch, type ClientLog } from "./kit";

const SHOWROOM = "/projects/showroom/scenity.project.json";
const CHARACTERS = "/projects/characters/scenity.project.json";
const WORKER = "/assets/sceneWorker.js";
const GPU = { backend: "webgpu", reason: "supported", adapter: "apple metal-3", ms: 1 } as const;

/** The behaviour of one fake client start. */
type Start = "ok" | "throw" | "fail-on-load" | "main" | "silent";

/**
 * A fake client factory: the start `n` does what `starts[n]` says ("ok" by default). "fail-on-load" reports a renderer
 * failure in the load; "main" is a worker plan that drew on the main thread; "silent" never draws a first frame.
 */
function scripted(log: ClientLog, starts: Start[], made: DocumentClientOptions[], stats: () => Partial<SceneStats>) {
  const base = fakeClient(log);
  return async (canvas: HTMLCanvasElement, options: DocumentClientOptions): Promise<DocumentClient> => {
    const start = starts[made.length] ?? "ok";
    made.push(options);
    if (start === "throw") throw new Error("Error creating WebGL context.");
    const client = await base(canvas, options);
    const mode = start === "main" || options.workerUrl === null ? "main" : "worker";
    const load: DocumentClient["load"] = (value) => {
      if (start === "fail-on-load") options.onFailure?.("The 3D scene worker did not start.");
      if (start === "silent") return new Promise(() => undefined);
      return client.load(value);
    };
    const statsOf = () => Promise.resolve({ mode, frames: 30, workP95: 1, ...stats() } as SceneStats);
    const scriptedClient: DocumentClient = { ...client, mode, load, stats: statsOf };
    return scriptedClient;
  };
}

function setup(options: Record<string, unknown>, starts: Start[], stats: () => Partial<SceneStats> = () => ({})) {
  const log = emptyLog();
  const made: DocumentClientOptions[] = [];
  let canvases = 0;
  const { deps, manual } = fakeDeps(log, {
    createClient: scripted(log, starts, made, stats),
    chooseBackend: () => Promise.resolve(GPU),
    replaceCanvas: () => {
      canvases += 1;
      return fakeCanvas();
    },
  });
  const player = createPlayerWith(fakeCanvas(), { project: SHOWROOM, ...options }, deps);
  const steps: PlayerFallback[] = [];
  player.on("fallback", (step) => steps.push(step));
  return { player, made, steps, manual, log, canvases: () => canvases };
}

describe("the renderer plans", () => {
  const choose = () => Promise.resolve(GPU);
  test("auto asks the chooser; the worker draws WebGL when the browser can run it", async () => {
    const input = {
      backend: "auto",
      workerAllowed: true,
      workerUsable: true,
      workerUrl: WORKER,
      chooseBackend: choose,
    };
    const { plan, noWorker } = await firstPlan({ ...input, backend: "auto" });
    expect(plan).toEqual({ workerUrl: WORKER, backend: GPU });
    expect(noWorker).toBeNull();
    expect(pathOf(plan)).toEqual({ renderer: "worker", backend: "webgl" });
    const none = await firstPlan({ ...input, backend: "auto", workerUsable: false });
    expect(none).toEqual({ plan: { workerUrl: null, backend: GPU }, noWorker: NO_WORKER_CANVAS });
    const gpu = await firstPlan({ ...input, backend: "webgpu" });
    expect(pathOf(gpu.plan)).toEqual({ renderer: "main", backend: "webgpu" });
    const gl = await firstPlan({ ...input, backend: "webgl", workerAllowed: false });
    expect(gl).toEqual({ plan: { workerUrl: null, backend: null }, noWorker: null });
  });

  test("the next plans: the worker to the main thread, WebGPU to WebGL, then nothing", () => {
    const worker = { workerUrl: WORKER, backend: GPU };
    const main = nextPlan(worker, pathOf(worker), WORKER);
    expect(main).toEqual({ workerUrl: null, backend: GPU });
    if (main === null) throw new Error("no plan");
    const gl = nextPlan(main, pathOf(main), null);
    expect(gl?.backend).toMatchObject({ backend: "webgl", reason: "device_lost", adapter: "apple metal-3" });
    if (gl === null) throw new Error("no plan");
    expect(nextPlan(gl, pathOf(gl), null)).toBeNull();
    // WebGPU that the options force goes to the WebGL worker when the worker did not fail.
    const forced = { workerUrl: null, backend: { ...GPU, reason: "url_override" as const } };
    expect(nextPlan(forced, pathOf(forced), WORKER)?.workerUrl).toBe(WORKER);
  });
});

describe("the fallbacks of the player", () => {
  test("a WebGPU failure in the load starts WebGL in the worker on a new canvas", async () => {
    const { player, made, steps, canvases } = setup({ backend: "webgpu" }, ["fail-on-load"]);
    await player.ready;
    expect(player.state).toBe("ready");
    expect(made.map((options) => [options.workerUrl, options.backend?.backend])).toEqual([
      [null, "webgpu"],
      [WORKER, "webgl"],
    ]);
    expect(steps).toEqual([
      {
        from: { renderer: "main", backend: "webgpu" },
        to: { renderer: "worker", backend: "webgl" },
        reason: "The 3D scene worker did not start.",
      },
    ]);
    expect(player.fallbacks).toEqual(steps);
    expect(player.renderer).toBe("worker");
    expect(canvases()).toBe(1);
  });

  test("a worker error goes to the main thread; a Worker constructor that throws is a step too", async () => {
    const failed = setup({}, ["fail-on-load"]);
    await failed.player.ready;
    expect(failed.steps.map((step) => [step.from.renderer, step.to?.renderer, step.to?.backend])).toEqual([
      ["worker", "main", "webgpu"],
    ]);
    expect(failed.player.renderer).toBe("main");
    const silent = setup({ backend: "webgl" }, ["main"]);
    await silent.player.ready;
    expect(silent.steps).toEqual([
      {
        from: { renderer: "worker", backend: "webgl" },
        to: { renderer: "main", backend: "webgl" },
        reason: WORKER_START,
      },
    ]);
  });

  test("no backend works: the error state, the poster stays, the last step goes to null", async () => {
    const { player, steps, manual } = setup({ backend: "webgpu", worker: false }, ["throw", "throw"]);
    const error = await player.ready.then(
      () => null,
      (reason: unknown) => String(reason),
    );
    expect(error).toContain("no renderer backend works: Error creating WebGL context.");
    expect(player.state).toBe("failed");
    expect(steps.map((step) => step.to)).toEqual([{ renderer: "main", backend: "webgl" }, null]);
    expect(manual.poster.at(-1)).toStartWith("fail no renderer backend works");
    expect(manual.poster).not.toContain("hide");
  });

  test("a content error does not fall back", async () => {
    const { player, steps, made } = setup({ camera: "nope" }, []);
    await player.ready.catch(() => undefined);
    expect(player.state).toBe("failed");
    expect(steps).toEqual([]);
    expect(made.length).toBe(1);
  });

  test("no first frame in time: the watchdog starts the next plan", async () => {
    const { player, steps, manual } = setup({}, ["silent"]);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    manual.tick(FIRST_FRAME_MS);
    await player.ready;
    expect(steps[0]?.reason).toBe("timeout: no first frame");
    expect(player.renderer).toBe("main");
  });

  test("a failure after the first frame starts the next plan; the clock goes on", async () => {
    const log = emptyLog();
    const made: DocumentClientOptions[] = [];
    const { deps, manual } = fakeDeps(log, {
      createClient: scripted(log, [], made, () => ({})),
      fetch: sampleFetch(),
    });
    const player = createPlayerWith(fakeCanvas(), { project: CHARACTERS, autoplay: true, camera: "front" }, deps);
    await player.ready;
    manual.advance(400);
    await player.setCamera("top");
    made[0]?.onBackendFailure?.("device_lost: gone");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(made.length).toBe(2);
    expect(player.state).toBe("ready");
    expect(player.playing).toBe(true);
    expect(player.renderer).toBe("main");
    // The new client gets the clock time and the camera of the last setCamera.
    expect(made[1]?.getSimMs()).toBe(400);
    expect(log.cameras.at(-1)).toBe("top");
    expect(player.fallbacks.map((step) => step.reason)).toEqual(["device_lost: gone"]);
  });
});

describe("the poster", () => {
  test("the poster of the scene shows at once and hides at the first frame; null turns it off", async () => {
    const scene = JSON.stringify({
      format: "scenity.scene/1",
      id: "main",
      poster: "../posters/main.webp",
      entities: { cam: { parent: null, index: 0, components: { camera: {} } } },
    });
    const fetch = sampleFetch({ "http://player.test/projects/showroom/scenes/main.scene.json": scene });
    const log = emptyLog();
    const { deps, manual } = fakeDeps(log, { fetch });
    await createPlayerWith(fakeCanvas(), { project: SHOWROOM, scene: "scenes/main.scene.json" }, deps).ready;
    expect(manual.poster).toEqual(["show http://player.test/projects/showroom/posters/main.webp", "hide"]);
    const off = fakeDeps(emptyLog(), { fetch });
    await createPlayerWith(fakeCanvas(), { project: SHOWROOM, poster: null }, off.deps).ready;
    expect(off.manual.poster).toEqual(["hide"]);
  });
});

describe("the adaptive quality ladder", () => {
  test("the tiers of the ladder: from the tier of the options down, within the project tiers", () => {
    expect(ladderTiers("high", undefined)).toEqual(["high", "medium", "low"]);
    expect(ladderTiers("ultra", ["low", "high"])).toEqual(["ultra", "high", "low"]);
    expect(ladderTiers("medium", ["high"])).toEqual(["medium"]);
  });

  test("two slow windows step down, good windows under half the limit step up (hysteresis)", () => {
    let state = LADDER_START;
    const run = (work: number) => {
      const result = ladderWindow(state, work, 30, 3);
      state = result.state;
      return result.action;
    };
    expect([run(9), run(9)]).toEqual(["none", "down"]);
    expect([run(9), run(9)]).toEqual(["none", "down"]);
    expect([run(9), run(9)]).toEqual(["none", "none"]);
    expect(state.step).toBe(2);
    // A work p95 between half the limit and the limit is neither slow nor good.
    expect(Array.from({ length: 20 }, () => run(4)).every((action) => action === "none")).toBe(true);
    const ups = Array.from({ length: GOOD_TO_STEP_UP }, () => run(1));
    expect(ups.at(-1)).toBe("up");
    expect(ladderWindow(state, 50, 0, 3).action).toBe("none");
  });

  test("the ladder acts in a live play only; a pause puts the tier of the options back", async () => {
    const { player, manual, log } = setup({ project: CHARACTERS }, [], () => ({ workP95: 1 }));
    const steps: string[] = [];
    player.on("quality", ({ tier, from }) => steps.push(`${from}>${tier}`));
    await player.ready;
    const tick = async () => {
      manual.tick(LADDER_WINDOW_MS);
      await new Promise((resolve) => setTimeout(resolve, 1));
    };
    player.simulateFrameWork(10);
    await tick();
    await tick();
    // No play: no step.
    expect(steps).toEqual([]);
    player.play();
    await tick();
    await tick();
    expect(steps).toEqual(["high>medium"]);
    expect(player.quality).toEqual({ on: true, tier: "medium", tiers: ["high", "medium", "low"] });
    player.pause();
    expect(log.tiers).toEqual(["medium", "high"]);
    player.play();
    expect(log.tiers.at(-1)).toBe("medium");
    // Null measures again: the fake core gives 1 ms.
    player.simulateFrameWork(null);
    for (let index = 0; index < GOOD_TO_STEP_UP; index += 1) await tick();
    expect(steps).toEqual(["high>medium", "medium>high"]);
  });

  test("adaptive false turns the ladder off", async () => {
    const { player, manual } = setup({ project: CHARACTERS, adaptive: false }, []);
    await player.ready;
    expect(player.quality?.on).toBe(false);
    expect([...manual.timers].some((timer) => timer.repeat)).toBe(false);
  });
});
