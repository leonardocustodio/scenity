// SPDX-License-Identifier: Apache-2.0
// The fallbacks of the player on the plain player pages player/showroom.html and player/characters.html. Each test
// forces a failure in the page before the player starts, with an init script, as a broken device or browser does:
//
// - WebGPU with no adapter (`navigator.gpu.requestAdapter` gives null) and `backend="webgpu"`: the player uses WebGL
//   in the generic scene worker and draws the baseline of the scene page;
// - a render worker that fails (an error event, a Worker constructor that throws, no OffscreenCanvas): the player
//   uses the main thread and draws the same baseline;
// - no WebGL, no WebGPU and no worker canvas: the player keeps the poster of the scene with the error state;
// - forced slow frames (the test hook `simulateFrameWork`): the adaptive quality ladder lowers the tier in a live
//   play and raises it again after fast frames. A seek after the steps draws the baseline of the tier of the options.
//
// The page HTML comes through a route that sets the attributes of <scenity-player>. Run it alone with the GPU lock and
// --workers=1: on a busy machine (a load over 20) a failure is not proof; run it again.
import { expect, test, type Page } from "@playwright/test";

const READY = { timeout: 30_000 };
test.describe.configure({ timeout: 120_000 });

type Attributes = Readonly<Record<string, string | null>>;

/** Serve a player page with other attributes on its element (null removes one). */
async function routeAttributes(page: Page, path: string, attributes: Attributes): Promise<void> {
  await page.route(`**${path}`, async (route) => {
    const response = await route.fetch();
    let html = await response.text();
    for (const [name, value] of Object.entries(attributes)) {
      html = html.replace(new RegExp(`\\s${name}(="[^"]*")?(?=[\\s>])`), "");
      if (value !== null) html = html.replace("<scenity-player", `<scenity-player ${name}="${value}"`);
    }
    await route.fulfill({ response, body: html });
  });
}

/** Open a player page with attributes and wait for a state of the player. */
async function open(page: Page, path: string, attributes: Attributes, state = "ready"): Promise<void> {
  await routeAttributes(page, path, attributes);
  await page.goto(path);
  await expect(page.getByTestId("player")).toHaveAttribute("data-state", state, READY);
}

function fallbacks(page: Page) {
  return page.evaluate(() => [...(document.querySelector("scenity-player")?.player?.fallbacks ?? [])]);
}

function stats(page: Page) {
  return page.evaluate(() => document.querySelector("scenity-player")?.player?.stats());
}

test("player: a WebGPU failure falls back to WebGL in the worker and draws", async ({ page }) => {
  await page.addInitScript(() => {
    // A browser with WebGPU and no adapter: the WebGPU renderer of three.js fails in its init.
    const gpu = { requestAdapter: () => Promise.resolve(null), getPreferredCanvasFormat: () => "bgra8unorm" };
    Object.defineProperty(navigator, "gpu", { value: gpu, configurable: true });
  });
  await open(page, "/player/showroom.html", { backend: "webgpu" });
  const player = page.getByTestId("player");
  await expect(player).toHaveAttribute("data-renderer", "worker");
  await expect(player).toHaveAttribute("data-backend", "webgl");
  const steps = await fallbacks(page);
  expect(steps).toHaveLength(1);
  expect(steps[0]).toMatchObject({
    from: { renderer: "main", backend: "webgpu" },
    to: { renderer: "worker", backend: "webgl" },
  });
  expect(steps[0]?.reason).toContain("init");
  expect((await stats(page))?.drawCalls ?? 0).toBeGreaterThan(10);
  await expect(page.getByTestId("player-poster")).toBeHidden();
  await expect(player).toHaveScreenshot("showroom--front.png");
});

/** The worker failures of the browser, each with the reason of its fallback step. */
const WORKER_FAILURES = [
  { name: "the worker sends an error", script: "error", reason: "forced worker failure" },
  { name: "the Worker constructor throws", script: "throw", reason: "worker_start" },
  { name: "the browser has no OffscreenCanvas", script: "offscreen", reason: "no_worker_canvas" },
] as const;

for (const failure of WORKER_FAILURES) {
  test(`player: ${failure.name}: the main thread draws`, async ({ page }) => {
    await page.addInitScript((kind) => {
      const Real = globalThis.Worker;
      if (kind === "offscreen") {
        Reflect.deleteProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen");
        return;
      }
      class FailedWorker extends Real {
        constructor(url: string | URL, options?: WorkerOptions) {
          if (kind === "throw" && options?.name === "scenity-room3d") throw new Error("forced worker failure");
          super(url, options);
          if (options?.name !== "scenity-room3d") return;
          setTimeout(() => this.dispatchEvent(new ErrorEvent("error", { message: "forced worker failure" })), 0);
        }
      }
      globalThis.Worker = FailedWorker;
    }, failure.script);
    // WebGL on both paths: the main-thread core draws the frame of the worker (showroom.spec.ts).
    await open(page, "/player/showroom.html", { backend: "webgl" });
    await expect(page.getByTestId("player")).toHaveAttribute("data-renderer", "main");
    const steps = await fallbacks(page);
    expect(steps).toEqual([
      {
        from: { renderer: "worker", backend: "webgl" },
        to: { renderer: "main", backend: "webgl" },
        reason: failure.reason,
      },
    ]);
    await expect(page.getByTestId("player")).toHaveAttribute("data-fallback", failure.reason);
    expect((await stats(page))?.drawCalls ?? 0).toBeGreaterThan(10);
    await expect(page.getByTestId("player")).toHaveScreenshot("showroom--front.png");
  });
}

test("player: no backend works: the poster stays with the error state", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
    Reflect.deleteProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen");
    // A browser with no WebGL and no WebGPU context: three.js cannot make a renderer.
    const prototype = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
    const getContext = prototype.getContext as (this: HTMLCanvasElement, ...args: unknown[]) => unknown;
    prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      return kind === "webgl" || kind === "webgl2" || kind === "webgpu" ? null : getContext.call(this, kind, ...rest);
    };
  });
  await open(page, "/player/showroom.html", {}, "failed");
  const poster = page.getByTestId("player-poster");
  await expect(poster).toBeVisible();
  await expect(poster).toHaveAttribute("src", /\/projects\/showroom\/posters\/main\.webp$/);
  await expect(poster).toHaveAttribute("data-error", /no renderer backend works/);
  expect(await poster.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  const steps = await fallbacks(page);
  expect(steps.at(0)?.reason).toBe("no_worker_canvas");
  expect(steps.at(-1)?.to).toBeNull();
});

test("player: the quality ladder steps down under slow frames and back up", async ({ page }) => {
  await open(page, "/player/characters.html", {});
  await page.evaluate(() => {
    const element = document.querySelector("scenity-player");
    const steps: unknown[] = [];
    Object.assign(globalThis, { qualitySteps: steps });
    element?.addEventListener("quality", (event) => steps.push((event as CustomEvent).detail));
    element?.player?.simulateFrameWork(20);
  });
  const steps = () =>
    page.evaluate(() => (globalThis as unknown as { qualitySteps: { from: string; tier: string }[] }).qualitySteps);
  const wait = { timeout: 30_000 };
  await expect
    .poll(async () => (await steps()).map((step) => `${step.from}>${step.tier}`), wait)
    .toEqual(["high>medium", "medium>low"]);
  expect((await stats(page))?.tier).toBe("low");
  // Determinism: a seek stops the clock, and the frame of the stopped clock has the tier of the options.
  await page.evaluate(async () => {
    await document.querySelector("scenity-player")?.seek(2500);
  });
  expect((await stats(page))?.tier).toBe("high");
  await expect(page.getByTestId("player")).toHaveScreenshot("characters--walk.png");
  // Fast frames in a live play: the ladder raises the tier again.
  await page.evaluate(() => {
    const player = document.querySelector("scenity-player")?.player;
    player?.simulateFrameWork(1);
    player?.play();
  });
  await expect.poll(async () => (await steps()).length, { timeout: 60_000 }).toBeGreaterThanOrEqual(3);
  expect((await steps())[2]).toMatchObject({ from: "low", tier: "medium" });
});
