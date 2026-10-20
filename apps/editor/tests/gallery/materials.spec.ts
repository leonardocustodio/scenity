// SPDX-License-Identifier: Apache-2.0
// The material types on both backends. The scene `materials` of
// samples/gltf-samples has one sphere for each material type of a material asset (standard, physical, Lambert, Phong,
// unlit) and a glTF model with material overrides per part. A camera of the document frames each one. For each camera
// the test draws the frame with WebGL and with WebGPU on the main thread of the same browser, and the two pictures stay
// inside the backend tolerance. A larger difference fails with both pictures and a map of the pixels that differ. The
// front view of the scene has its baselines in gltf-samples.spec.ts. The project "scene-webgpu" runs this file; on a
// machine with no WebGPU adapter it skips with a notice.
import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { diffFrames } from "../support/room3d-helpers";

/** The cameras of the scene: one for each material type, and one for the model with the overrides. */
const CAMERAS = ["standard", "physical", "lambert", "phong", "unlit", "override"] as const;

/**
 * The backend tolerance of a material frame: a pixel differs when one channel differs by more than THRESHOLD levels,
 * and at most MAX_SHARE of the pixels may differ. The values are those of the backend check of the 3D room.
 */
const THRESHOLD = 24;
const MAX_SHARE = 0.015;

const READY = { timeout: 30_000 };
test.describe.configure({ timeout: 120_000 });

/** A picture of a camera of the scene on a backend, after the first frame with every asset. */
async function shot(page: Page, camera: string, backend: "webgl" | "webgpu"): Promise<Buffer> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const query = backend === "webgpu" ? "&backend=webgpu" : "&worker=0";
  await page.goto(`/scene.html?project=gltf-samples&scene=scenes/materials.scene.json&camera=${camera}${query}`);
  const view = page.getByTestId("scene-view");
  await expect(view, `the page errors: ${errors.join("; ")}`).toHaveAttribute("data-ready", "1", READY);
  await expect(page.locator("#status")).toHaveText("");
  await page.evaluate(() => globalThis.__scenity?.frame());
  const stats = await page.evaluate(() => globalThis.__scenity?.stats());
  expect(stats?.backend).toBe(backend);
  return view.screenshot({ animations: "disabled", caret: "hide", scale: "css" });
}

test.describe("the material types on WebGL and WebGPU", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== "scene-webgpu", "this set runs in the project scene-webgpu");
    // A page of the origin with no scene (the server answers 404): WebGPU needs a secure context, as the loopback is.
    await page.goto("/assets/no-page");
    const adapter = await page.evaluate(async () => {
      const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
      return gpu !== undefined && (await gpu.requestAdapter()) !== null;
    });
    test.skip(!adapter, "no WebGPU adapter in this browser");
  });

  for (const camera of CAMERAS) {
    test(`material ${camera}: WebGL and WebGPU`, async ({ page, context }, info) => {
      const gl = await shot(page, camera, "webgl");
      const gpu = await shot(page, camera, "webgpu");
      const diff = await diffFrames(context, gpu, gl, THRESHOLD);
      const share = diff.over / (diff.width * diff.height);
      const differ = diff.differ / (diff.width * diff.height);
      console.log(`[material-backends] ${JSON.stringify({ camera, share, differ, maxDelta: diff.maxDelta })}`);
      if (share > MAX_SHARE || diff.differ < 0) {
        for (const [file, body] of [
          ["webgpu.png", gpu],
          ["webgl.png", gl],
          ["differ.png", Buffer.from(diff.map, "base64")],
        ] as const) {
          writeFileSync(info.outputPath(file), body);
          await info.attach(file, { path: info.outputPath(file) });
        }
      }
      expect(diff.differ, `${camera}: the two pictures have the same size`).toBeGreaterThanOrEqual(0);
      expect(
        share,
        `${camera}: ${String(diff.over)} pixels differ by more than ${String(THRESHOLD)} levels`,
      ).toBeLessThanOrEqual(MAX_SHARE);
    });
  }
});
