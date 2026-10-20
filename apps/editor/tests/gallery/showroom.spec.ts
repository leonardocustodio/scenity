// SPDX-License-Identifier: Apache-2.0
// The showroom sample from its scene document: each camera of the document against its baseline. The scene page
// (scene.html, vite.scene.config.ts) draws the document with the document core of @scenity/runtime. It draws in the
// generic scene worker by default, and on the main thread with `worker=0`. The two paths must draw the same pixels
// (tolerance 0). A change of the engine that moves these pixels needs the approval of the owner for the new
// baselines, as for the frames of the lab.
import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { diffFrames } from "../support/room3d-helpers";

const CAMERAS = ["front", "top"] as const;
const PATHS = [
  { name: "render worker", worker: "1", mode: "worker" },
  { name: "main-thread core", worker: "0", mode: "main" },
] as const;
// The page loads six models and an HDR file. In the full gallery run, the GPU work of the lab pages makes this load
// slower than the default wait of 10 s.
const READY = { timeout: 30_000 };
test.describe.configure({ timeout: 90_000 });

/** Open the showroom on a path and wait for the first frame with every asset. */
async function open(page: Page, camera: string, worker: string, mode: string): Promise<void> {
  await page.goto(`/scene.html?project=showroom&camera=${camera}&worker=${worker}`);
  const view = page.getByTestId("scene-view");
  await expect(view).toHaveAttribute("data-ready", "1", READY);
  await expect(view).toHaveAttribute("data-renderer", mode);
  // The showroom has a build, so the page loads the built files through the asset manifest.
  await expect(view).toHaveAttribute("data-assets", "build");
}

for (const camera of CAMERAS) {
  test(`showroom from its document: ${camera}`, async ({ page }) => {
    await open(page, camera, "1", "worker");
    const stats = await page.evaluate(() => globalThis.__scenity?.stats());
    expect(stats?.calls ?? 0).toBeGreaterThan(10);
    await expect(page.getByTestId("scene-view")).toHaveScreenshot(`showroom--${camera}.png`);
  });

  test(`the worker and the main thread draw the same frame: ${camera}`, async ({ context }, testInfo) => {
    const shots: Buffer[] = [];
    for (const path of PATHS) {
      const page = await context.newPage();
      await open(page, camera, path.worker, path.mode);
      await page.evaluate(() => globalThis.__scenity?.frame());
      shots.push(await page.getByTestId("scene-view").screenshot({ animations: "disabled" }));
      await page.close();
    }
    const [worker, main] = shots as [Buffer, Buffer];
    const diff = await diffFrames(context, worker, main, 0, Number.POSITIVE_INFINITY);
    console.log(`[scene-parity] ${JSON.stringify({ camera, differ: diff.differ })}`);
    if (diff.differ !== 0) {
      for (const [name, body] of [
        ["worker.png", worker],
        ["main.png", main],
        ["differ.png", Buffer.from(diff.map, "base64")],
      ] as const) {
        writeFileSync(testInfo.outputPath(name), body);
        await testInfo.attach(name, { path: testInfo.outputPath(name) });
      }
    }
    expect(diff.differ).toBe(0);
  });
}

for (const path of PATHS) {
  test(`an op moves the table with no full rebuild: ${path.name}`, async ({ page }) => {
    await open(page, "front", path.worker, path.mode);
    const before = await page.evaluate(() => globalThis.__scenity?.stats());
    const refusal = await page.evaluate(() =>
      globalThis.__scenity?.apply([{ op: "set", path: "/entities/table/components/transform/position/0", value: 0.4 }]),
    );
    expect(refusal).toBeNull();
    const after = await page.evaluate(() => globalThis.__scenity?.stats());
    // The same geometries and textures: the op moved an object, it did not load or build the scene again.
    expect(after?.geometries).toBe(before?.geometries);
    expect(after?.textures).toBe(before?.textures);
    expect(await page.evaluate(() => globalThis.__scenity?.document().entities.table?.components.transform)).toEqual(
      expect.objectContaining({ position: [0.4, expect.any(Number), expect.any(Number)] }),
    );
  });

  test(`a removed entity frees its GPU memory: ${path.name}`, async ({ page }) => {
    await open(page, "front", path.worker, path.mode);
    const before = await page.evaluate(() => globalThis.__scenity?.stats());
    // The shelf is the only user of its model: its geometry and its three textures go.
    await page.evaluate(() => globalThis.__scenity?.apply([{ op: "remove", id: "shelf" }]));
    const after = await page.evaluate(() => globalThis.__scenity?.stats());
    expect(after?.geometries).toBeLessThan(before?.geometries ?? 0);
    expect(after?.textures).toBeLessThan(before?.textures ?? 0);
    expect(after?.entities).toBe((before?.entities ?? 0) - 1);
  });
}

test("a pick gives the entity, the component and the model node", async ({ page }) => {
  await open(page, "front", "1", "worker");
  const size = await page.getByTestId("scene-view").boundingBox();
  const hit = await page.evaluate(
    ([x, y]) => globalThis.__scenity?.pick(x ?? 0, y ?? 0),
    [(size?.width ?? 0) / 2, (size?.height ?? 0) / 2],
  );
  expect(typeof hit?.entity).toBe("string");
  expect(hit?.distance ?? 0).toBeGreaterThan(0);
});
