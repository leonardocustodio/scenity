// SPDX-License-Identifier: Apache-2.0
// The project plugins in the document core: the spin sample lists the demo plugin (samples/spin/plugins/demo). Its
// system turns the box `spinner` at 90 degrees per second in fixed steps. Its presenter draws a hub ring around the
// box. The scene page and the player run the plugin in the worker and on the main thread, and both paths draw the same
// frame. The tests read the inspect report and compare the canvas at two times and on two paths. The frames at the
// two times also go against their baselines (`spin--<name>.png`), as in the galleries of the other samples. Run it
// with the GPU lock and --workers=1.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { diffFrames } from "../support/room3d-helpers";

const READY = { timeout: 30_000 };
test.describe.configure({ timeout: 90_000 });

const PATHS = [
  { worker: "1", mode: "worker" },
  { worker: "0", mode: "main" },
] as const;

/** The turn about Y of a quaternion [x, y, z, w] in degrees, in [0, 360). */
function yaw(rotation: readonly number[] | undefined): number {
  const [, y = 0, , w = 1] = rotation ?? [];
  const angle = (2 * Math.atan2(y, w) * 180) / Math.PI;
  return ((angle % 360) + 360) % 360;
}

/** Open the spin scene at a time on a path and wait for the first frame with every asset. */
async function openScene(page: Page, worker: string, mode: string, t: number): Promise<void> {
  await page.goto(
    `/scene.html?project=spin&scene=scenes/spin.scene.json&camera=front&t=${String(t)}&paused=1&worker=${worker}`,
  );
  const view = page.getByTestId("scene-view");
  await expect(view).toHaveAttribute("data-ready", "1", READY);
  await expect(view).toHaveAttribute("data-renderer", mode);
}

/** The spinner entity of the inspect report of the last frame. */
async function spinner(page: Page) {
  const report = await page.evaluate(() => globalThis.__scenity?.inspect?.());
  return report?.entities.find((entity) => entity.id === "spinner");
}

for (const path of PATHS) {
  test(`the scene page runs the demo plugin: ${path.mode}`, async ({ page }) => {
    await openScene(page, path.worker, path.mode, 500);
    const first = await spinner(page);
    expect(first?.components).toEqual(["demo.spin", "shape", "transform"]);
    // The box and the hub ring of the presenter.
    expect(first?.stats.meshes).toBe(2);
    expect(yaw(first?.transform.rotation)).toBeCloseTo(45, 1);
    await page.evaluate(() => globalThis.__scenity?.seek?.(1500));
    expect(yaw((await spinner(page))?.transform.rotation)).toBeCloseTo(135, 1);
    // A seek to an earlier time gives the frame of a play (the system memory restores a checkpoint).
    await page.evaluate(() => globalThis.__scenity?.seek?.(500));
    expect(yaw((await spinner(page))?.transform.rotation)).toBeCloseTo(45, 1);
  });
}

/** The frames of the sample against their baselines: the box at 45 degrees, then at 135 degrees. */
const FRAMES = [
  ["start", 500],
  ["turn", 1500],
] as const;

for (const [name, t] of FRAMES) {
  test(`spin: the sample at "${name}" (${String(t)} ms)`, async ({ page }) => {
    await openScene(page, "1", "worker", t);
    await page.evaluate(() => globalThis.__scenity?.frame());
    await expect(page.getByTestId("scene-view")).toHaveScreenshot(`spin--${name}.png`);
  });
}

/** A screenshot of the scene page at a time on a path, in a new page. */
async function sceneShot(context: BrowserContext, worker: string, mode: string, t: number): Promise<Buffer> {
  const page = await context.newPage();
  await openScene(page, worker, mode, t);
  await page.evaluate(() => globalThis.__scenity?.frame());
  const shot = await page.getByTestId("scene-view").screenshot({ animations: "disabled" });
  await page.close();
  return shot;
}

test("the worker and the main thread draw the same turned frame", async ({ context }) => {
  const worker = await sceneShot(context, "1", "worker", 1500);
  const main = await sceneShot(context, "0", "main", 1500);
  expect((await diffFrames(context, worker, main, 0, Number.POSITIVE_INFINITY)).differ).toBe(0);
});

/** Open the player page of the spin sample on a path. */
async function openPlayer(page: Page, mode: string): Promise<void> {
  await page.goto("/player/spin.html");
  const player = page.getByTestId("player");
  if (mode === "main") {
    // A change of an attribute starts the player again.
    await expect(player).toHaveAttribute("data-state", "ready", READY);
    await page.evaluate(() => document.querySelector("scenity-player")?.setAttribute("worker", "false"));
  }
  await expect(player).toHaveAttribute("data-renderer", mode, READY);
  await expect(player).toHaveAttribute("data-state", "ready", READY);
}

/** Stand at a time of the sequence and give a screenshot of its frame. */
async function playerShot(page: Page, t: number): Promise<Buffer> {
  await page.evaluate(async (time) => {
    await document.querySelector("scenity-player")?.seek(time);
  }, t);
  expect(await page.evaluate(() => document.querySelector("scenity-player")?.currentTime)).toBe(t);
  return page.getByTestId("player").screenshot({ animations: "disabled" });
}

test("the player runs the demo plugin in the worker and on the main thread", async ({ context }) => {
  const shots: Record<string, Buffer> = {};
  for (const mode of ["worker", "main"]) {
    const page = await context.newPage();
    await openPlayer(page, mode);
    const before = await playerShot(page, 500);
    const after = await playerShot(page, 1500);
    expect((await diffFrames(context, before, after, 0, Number.POSITIVE_INFINITY)).differ).toBeGreaterThan(100);
    shots[mode] = after;
    await page.close();
  }
  const { worker, main } = shots as { worker: Buffer; main: Buffer };
  expect((await diffFrames(context, worker, main, 0, Number.POSITIVE_INFINITY)).differ).toBe(0);
  // The release core of the player draws the frame of the dev core of the scene page.
  const scene = await sceneShot(context, "1", "worker", 1500);
  expect((await diffFrames(context, worker, scene, 0, Number.POSITIVE_INFINITY)).differ).toBe(0);
});
