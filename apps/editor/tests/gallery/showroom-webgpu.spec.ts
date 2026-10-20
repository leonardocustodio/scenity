// SPDX-License-Identifier: Apache-2.0
// The showroom sample with its built assets on WebGPU: the main scene with the KTX2 textures and the LOD files of
// samples/showroom/build, drawn by the WebGPU document core on the main thread. Each camera goes against its baseline
// in __screenshots__/scene-webgpu-darwin. The project "scene-webgpu" runs this file. On a machine with no WebGPU
// adapter, it skips with a notice. The loader must choose the KTX2 target after the device is ready. A choice before
// that time makes the WebGPU upload of the RGBA fallback fail.
import { expect, test, type Page } from "@playwright/test";
import { ciWaitMs } from "../support/ci-timing";

const CAMERAS = ["front", "top"] as const;
const READY = { timeout: ciWaitMs(60_000) };
test.describe.configure({ timeout: ciWaitMs(120_000) });

/** True when the browser of the page has a WebGPU adapter. */
async function hasAdapter(page: Page): Promise<boolean> {
  // A page of the origin with no scene (the server answers 404): WebGPU needs a secure context, as the loopback is.
  await page.goto("/assets/no-page");
  return page.evaluate(async () => {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return gpu !== undefined && (await gpu.requestAdapter()) !== null;
  });
}

test.beforeEach(async ({ page }) => {
  test.skip(test.info().project.name !== "scene-webgpu", "this set runs in the project scene-webgpu");
  test.skip(!(await hasAdapter(page)), "no WebGPU adapter in this browser");
});

for (const camera of CAMERAS) {
  test(`showroom with the built assets on WebGPU: ${camera}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/scene.html?project=showroom&camera=${camera}&backend=webgpu`);
    const view = page.getByTestId("scene-view");
    // The wait ends at the first frame with every asset, or at the first page error.
    await expect
      .poll(async () => errors.length > 0 || (await view.getAttribute("data-ready")) === "1", READY)
      .toBe(true);
    expect(errors).toEqual([]);
    await expect(page.locator("#status")).toHaveText("");
    await expect(view).toHaveAttribute("data-assets", "build");
    const stats = await page.evaluate(() => globalThis.__scenity?.stats());
    expect(stats?.backend).toBe("webgpu");
    expect(stats?.calls ?? 0).toBeGreaterThan(10);
    await page.evaluate(() => globalThis.__scenity?.frame());
    await expect(view).toHaveScreenshot(`showroom--${camera}.png`);
  });
}
