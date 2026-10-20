// SPDX-License-Identifier: Apache-2.0
// A scene with 500 copies of one model: the crowd scene of the showroom
// (scenes/crowd.scene.json, the wooden table with two levels of detail). The repeated tables draw as instance batches,
// the far tables take the coarser level, and the frame stays inside the budget of the medium tier:
//
// - the frame work (the update and the render calls of the core) at the 95th percentile is at most 6 ms, and the GPU
//   time at the 95th percentile is at most 10 ms when the browser has a GPU timer (the frame limits of the medium
//   tier, `MEDIUM` below);
// - the draw calls and the triangles of a frame (the main pass and the shadow pass) are under
//   `quality.budgets.scene.medium` of the showroom project.
//
// The medium tier caps the level of detail: the showroom build has the levels "high" and "low", so each table shows
// its "low" level there.
//
// Run this file alone with --workers=1: the frame times of parallel GPU pages are not real. On CI (WebGL on the CPU)
// the test checks the draw calls and the triangles only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { overBudget, projectBudget, readDocument } from "@scenity/scene";

const SHOWROOM = join(import.meta.dirname, "../../../../samples/showroom");
const CROWD = "scenes/crowd.scene.json";
/** The frame limits of the medium tier (ms, 95th percentile). */
const MEDIUM = { work: 6, gpu: 10 } as const;
/** The frames of the measure window. */
const FRAMES = 120;
const READY = { timeout: 60_000 };
test.describe.configure({ timeout: 180_000 });

/** Open the crowd scene and wait for the first frame with every asset. */
async function open(page: Page, query: string): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/scene.html?project=showroom&scene=${CROWD}&camera=front${query}`);
  const view = page.getByTestId("scene-view");
  await expect(view, `the page errors: ${errors.join("; ")}`).toHaveAttribute("data-ready", "1", READY);
  await expect(page.locator("#status")).toHaveText("");
  await expect(view).toHaveAttribute("data-assets", "build");
  await page.evaluate(() => globalThis.__scenity?.frame());
}

/** The scene budget of a tier in the showroom project. */
function sceneBudget(tier: string) {
  const read = readDocument(readFileSync(join(SHOWROOM, "scenity.project.json"), "utf8"), "project");
  if (!read.ok) throw new Error(JSON.stringify(read.errors));
  const budget = projectBudget(read.doc, "scene", tier);
  if (budget === undefined) throw new Error(`the showroom has no scene budget for the tier ${tier}`);
  return budget;
}

test("crowd of 500 tables: the front camera", async ({ page }) => {
  await open(page, "");
  const stats = await page.evaluate(() => globalThis.__scenity?.stats());
  expect(stats?.entities).toBe(505);
  expect(stats?.instances).toBe(500);
  // The far tables take the low level (476 triangles in place of 952): fewer triangles than 500 high tables in the
  // main pass and the shadow pass.
  expect(stats?.triangles ?? 0).toBeLessThan(2 * 500 * 952);
  expect(stats?.triangles ?? 0).toBeGreaterThan(2 * 500 * 476);
  await expect(page.getByTestId("scene-view")).toHaveScreenshot("showroom--crowd.png");
});

test("crowd of 500 tables: inside the frame budget of the medium tier", async ({ page }) => {
  await open(page, "&tier=medium&gpu=1");
  await page.evaluate(() => globalThis.__scenity?.stats(true));
  // Each frame call draws one frame of the core (an empty patch) and waits for the next paint.
  await page.evaluate(async (frames) => {
    for (let i = 0; i < frames; i += 1) await globalThis.__scenity?.frame();
  }, FRAMES);
  const stats = await page.evaluate(() => globalThis.__scenity?.stats());
  if (stats === undefined) throw new Error("the scene page has no script API");
  console.log(`[crowd-perf] ${JSON.stringify(stats)}`);
  expect(stats.tier).toBe("medium");
  expect(stats.frames).toBeGreaterThanOrEqual(FRAMES);
  expect(stats.instances).toBe(500);
  expect(overBudget(sceneBudget("medium"), { drawCalls: stats.calls, triangles: stats.triangles })).toEqual([]);
  // The CI runners draw WebGL on the CPU (SwiftShader): their frame times are not a measure of the budget.
  if (process.env.CI === "true") return;
  expect(stats.workP95).toBeLessThanOrEqual(MEDIUM.work);
  if (stats.gpuP95 !== null) expect(stats.gpuP95).toBeLessThanOrEqual(MEDIUM.gpu);
});
