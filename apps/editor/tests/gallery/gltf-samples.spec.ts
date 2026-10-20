// SPDX-License-Identifier: Apache-2.0
// The Khronos glTF samples of the generic loader: one scene per sample, each with an extension of the loader (the
// lights, the physical materials, unlit, WebP, AVIF, GPU instancing, Draco). The scene page draws each scene with WebGL
// in the generic scene worker (project "scene"). It also draws it with WebGPU on the main thread (project
// "scene-webgpu"), because the generic scene worker draws with WebGL only. Each frame goes against its baseline. On a
// machine with no WebGPU adapter (the headless shell of Linux), the WebGPU set skips with a notice.
import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { diffFrames } from "../support/room3d-helpers";

/** The scenes of samples/gltf-samples (scenes/<name>.scene.json). */
const SCENES = [
  "anisotropy-strength-test",
  "attenuation-test",
  "box-draco",
  "clear-coat-test",
  "emissive-strength-test",
  "ior-test-grid",
  "iridescence-suzanne",
  // One sphere for each material type of a material asset, and a model with material overrides.
  "materials",
  "point-light-intensity-test",
  "sheen-test-grid",
  "simple-instancing",
  "specular-test",
  "texture-avif",
  "texture-webp",
  "transmission-roughness-test",
  "unlit-test",
] as const;

const READY = { timeout: 30_000 };
test.describe.configure({ timeout: 90_000 });

/** Open a sample scene with a backend and wait for the first frame with every asset. */
async function open(page: Page, scene: string, query: string): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/scene.html?project=gltf-samples&scene=scenes/${scene}.scene.json&camera=front${query}`);
  const view = page.getByTestId("scene-view");
  await expect(view, `the page errors: ${errors.join("; ")}`).toHaveAttribute("data-ready", "1", READY);
  await expect(page.locator("#status")).toHaveText("");
  await page.evaluate(() => globalThis.__scenity?.frame());
}

/** Skip a test of another project: the WebGL set runs in "scene", the WebGPU set in "scene-webgpu". */
function onlyIn(project: string): void {
  test.skip(test.info().project.name !== project, `this set runs in the project ${project}`);
}

/** True when the browser of the page has a WebGPU adapter. */
async function hasAdapter(page: Page): Promise<boolean> {
  // A page of the origin with no scene (the server answers 404): WebGPU needs a secure context, as the loopback is.
  await page.goto("/assets/no-page");
  return page.evaluate(async () => {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return gpu !== undefined && (await gpu.requestAdapter()) !== null;
  });
}

test.describe("WebGL in the generic scene worker", () => {
  for (const scene of SCENES) {
    test(`gltf sample ${scene}: WebGL`, async ({ page }) => {
      onlyIn("scene");
      await open(page, scene, "");
      await expect(page.getByTestId("scene-view")).toHaveAttribute("data-renderer", "worker");
      await expect(page.getByTestId("scene-view")).toHaveScreenshot(`gltf-samples--${scene}.png`);
    });
  }

  // Draco is a chunk of the worker and of the main-thread core; GPU instancing draws one mesh many times.
  for (const scene of ["box-draco", "simple-instancing"] as const) {
    test(`gltf sample ${scene}: the worker and the main thread draw the same frame`, async ({ context }, info) => {
      onlyIn("scene");
      const shots: Buffer[] = [];
      for (const worker of ["1", "0"]) {
        const page = await context.newPage();
        await open(page, scene, `&worker=${worker}`);
        shots.push(await page.getByTestId("scene-view").screenshot({ animations: "disabled" }));
        await page.close();
      }
      const [worker, main] = shots as [Buffer, Buffer];
      const diff = await diffFrames(context, worker, main, 0, Number.POSITIVE_INFINITY);
      if (diff.differ !== 0) {
        writeFileSync(info.outputPath("differ.png"), Buffer.from(diff.map, "base64"));
        await info.attach("differ.png", { path: info.outputPath("differ.png") });
      }
      expect(diff.differ).toBe(0);
    });
  }
});

test.describe("WebGPU on the main thread", () => {
  for (const scene of SCENES) {
    test(`gltf sample ${scene}: WebGPU`, async ({ page }) => {
      onlyIn("scene-webgpu");
      test.skip(!(await hasAdapter(page)), "no WebGPU adapter in this browser");
      await open(page, scene, "&backend=webgpu");
      const stats = await page.evaluate(() => globalThis.__scenity?.stats());
      expect(stats?.backend).toBe("webgpu");
      await expect(page.getByTestId("scene-view")).toHaveScreenshot(`gltf-samples--${scene}.png`);
    });
  }
});
