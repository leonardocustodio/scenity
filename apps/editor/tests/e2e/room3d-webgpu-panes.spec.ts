// SPDX-License-Identifier: Apache-2.0
// The pane loop on both backends. One renderer draws two panes on one canvas, as the split screen does. Each pane has
// its viewport, its scissor and its own scene. A report said that the WebGPU backend of three.js ignores the viewport
// and the scissor of a pass. This test checks the plain `render` of the backend modules of the runtime
// (render/webgl.ts, render/webgpu.ts), with the automatic clear and with one clear per pane. Each pane must show its
// background and its box, and the second pane must not clear the first.
//
// Run (in apps/editor): bunx --bun playwright test tests/e2e/room3d-webgpu-panes.spec.ts --project chromium --headed
// A browser without a WebGPU adapter (the headless shell, a GPU-less runner) skips the WebGPU cases with a notice.
import { join } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import { decode } from "fast-png";
import { ciWaitMs } from "../support/ci-timing";
import { gpuLock } from "../../scripts/lab/gpuLock";
import { PANE, type PaneRequest, type PaneResult } from "./panes/panePage";

/** The test page: an empty document and the bundle of panes/panePage.ts. */
async function servePanes(): Promise<{ url: string; stop: () => void }> {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, "panes", "panePage.ts")], target: "browser" });
  const bundle = built.outputs[0];
  if (!built.success || bundle === undefined)
    throw new Error(`panes: the bundle failed: ${built.logs.map((log) => log.message).join("\n")}`);
  const script = await bundle.text();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/panes.js") {
        return new Response(script, { headers: { "content-type": "text/javascript" } });
      }
      const html = '<!doctype html><body style="margin:0"><script type="module" src="/panes.js"></script></body>';
      return new Response(html, { headers: { "content-type": "text/html" } });
    },
  });
  return { url: `http://127.0.0.1:${String(server.port)}/`, stop: () => void server.stop(true) };
}

const test = base.extend<object, { panes: { url: string } }>({
  panes: [
    // Playwright reads the fixture names from the destructured first parameter.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const server = await servePanes();
      await use(server);
      server.stop();
    },
    { scope: "worker" },
  ],
});

// Chromium in its new headless mode: the headless shell has no WebGPU adapter.
test.use({
  channel: [
    async ({ browserName }, use) => use(browserName === "chromium" ? "chromium" : undefined),
    { scope: "worker" },
  ],
  viewport: { width: 400, height: 200 },
  deviceScaleFactor: 1,
});
test.describe.configure({ mode: "serial", timeout: ciWaitMs(60_000) });

let release: (() => void) | null = null;
test.beforeEach(async () => {
  // The wait for the GPU lock is part of the time of the test: give it the 15 minutes of the lock.
  test.setTimeout(16 * 60_000);
  release = await gpuLock({ timeoutMs: 15 * 60_000, log: (text) => console.log(text) });
});
test.afterEach(() => {
  release?.();
  release = null;
});

/** Draw the two panes and give the RGB of the canvas at each point (CSS pixels). */
async function drawAndRead(
  page: Page,
  url: string,
  request: PaneRequest,
  points: readonly (readonly [number, number])[],
): Promise<{ readonly result: PaneResult; readonly rgb: (readonly number[])[] }> {
  await page.goto(url);
  await page.waitForFunction(() => "__panes" in globalThis);
  const result = await page.evaluate(
    (input) => (globalThis as unknown as { __panes(request: PaneRequest): Promise<PaneResult> }).__panes(input),
    request,
  );
  const image = decode(await page.getByTestId("panes").screenshot());
  const channels = image.channels;
  const rgb = points.map(([x, y]) => {
    const at = (y * image.width + x) * channels;
    return [image.data[at] ?? 0, image.data[at + 1] ?? 0, image.data[at + 2] ?? 0];
  });
  return { result, rgb };
}

/**
 * True when one channel leads: 0 red, 1 green. The backgrounds are colours that ACES Filmic can give (panePage.ts), so
 * both backends show the plain colour (208, 32, 32 and 32, 176, 32). A pure primary colour is outside that range: on
 * WebGPU a pane shows the nearest colour (pure green gave 227, 249, 188 on 2026-10-14, render/webgpu.ts `drawPane`).
 * The test asks for a lead of 60 levels, not for an exact colour.
 */
function mostly(rgb: readonly number[], channel: 0 | 1): boolean {
  const main = rgb[channel] ?? 0;
  return main > 150 && rgb.every((value, index) => index === channel || main - value >= 60);
}

/** True when the colour is a light grey (the white box after the tone mapping). */
function grey(rgb: readonly number[]): boolean {
  const [r = 0, g = 0, b = 0] = rgb;
  return r > 120 && Math.max(Math.abs(r - g), Math.abs(g - b)) < 24;
}

for (const backend of ["webgpu", "webgl"] as const) {
  for (const autoClear of [true, false]) {
    test(`two panes with a viewport and a scissor each: ${backend}, ${autoClear ? "automatic clear" : "one clear per pane"}`, async ({
      page,
      panes,
    }) => {
      if (backend === "webgpu") {
        await page.goto(panes.url);
        const adapter = await page.evaluate(async () => {
          const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
          return gpu === undefined ? false : (await gpu.requestAdapter()) !== null;
        });
        test.skip(!adapter, "this browser has no WebGPU adapter (a GPU-less runner or the headless shell)");
      }
      const half = PANE / 2;
      // The background of each pane at its outer edge and next to the line between the panes, and each box.
      const points = [
        [4, half],
        [PANE - 3, half],
        [half, half],
        [PANE + 2, half],
        [PANE * 2 - 4, half],
        [PANE + half, half],
      ] as const;
      const { result, rgb } = await drawAndRead(page, panes.url, { backend, autoClear }, points);
      console.log(`[room3d-webgpu-panes] ${JSON.stringify({ backend, autoClear, ...result, rgb })}`);
      expect(result).toEqual({ kind: backend, failed: null });
      const [leftEdge = [], leftLine = [], leftBox = [], rightLine = [], rightEdge = [], rightBox = []] = rgb;
      expect(mostly(leftEdge, 0) && mostly(leftLine, 0), `pane 1 is red: ${JSON.stringify(rgb)}`).toBe(true);
      expect(mostly(rightEdge, 1) && mostly(rightLine, 1), `pane 2 is green: ${JSON.stringify(rgb)}`).toBe(true);
      expect(grey(leftBox) && grey(rightBox), `each pane draws its box: ${JSON.stringify(rgb)}`).toBe(true);
    });
  }
}
