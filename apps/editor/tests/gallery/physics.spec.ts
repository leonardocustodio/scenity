// SPDX-License-Identifier: Apache-2.0
// The physics sample (samples/physics): the physics plugin steps a Rapier world (the deterministic build) at the fixed
// step of the systems, and a probe plugin casts rays in it. The frames of three markers go against their baselines.
// The sample replays to the same frames. A live play pauses at three times and keeps each frame. A seek to 0 and a
// play again (forward seeks through the times) give the same pixels at the three times. The worker, the main thread
// and the player draw the same frame. Run it with the GPU lock and --workers=1. A failure at a load over 20 is not
// proof.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { diffFrames } from "../support/room3d-helpers";

const READY = { timeout: 30_000 };
test.describe.configure({ timeout: 120_000 });

/** The markers of the sequence and their baselines: the crates on the floor, the push, the kick of the ball. */
const MOMENTS = [
  ["settle", 1500],
  ["push", 5500],
  ["kick", 7000],
] as const;

async function open(page: Page, t: number, worker = "1", camera = "front"): Promise<void> {
  await page.goto(
    `/scene.html?project=physics&scene=scenes/physics.scene.json&camera=${camera}&paused=1&t=${String(t)}&worker=${worker}`,
  );
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
}

async function seek(page: Page, t: number): Promise<void> {
  await page.evaluate(async (time) => {
    await globalThis.__scenity?.seek?.(time);
    await globalThis.__scenity?.frame();
  }, t);
}

function shot(page: Page): Promise<Buffer> {
  return page.getByTestId("scene-view").screenshot({ animations: "disabled" });
}

for (const [name, t] of MOMENTS) {
  test(`physics: the sample at "${name}" (${String(t)} ms)`, async ({ page }) => {
    await open(page, t);
    await seek(page, t);
    expect(await page.evaluate(() => globalThis.__scenity?.time?.())).toBe(t);
    await expect(page.getByTestId("scene-view")).toHaveScreenshot(`physics--${name}.png`);
  });
}

/** Continue the play from the clock time until the clock passes `t`, then pause. Give the time and the frame. */
async function playUntil(page: Page, t: number): Promise<{ t: number; frame: Buffer }> {
  await page.evaluate(() => globalThis.__scenity?.play?.());
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.time?.() ?? 0), READY).toBeGreaterThan(t);
  await page.evaluate(async () => {
    globalThis.__scenity?.pause?.();
    await globalThis.__scenity?.frame();
  });
  const at = (await page.evaluate(() => globalThis.__scenity?.time?.())) ?? 0;
  return { t: at, frame: await shot(page) };
}

test("physics: a play, a seek back and a play again give the same frames at three times", async ({ page }) => {
  await open(page, 0);
  const played = [];
  for (const t of [1200, 3800, 6200]) played.push(await playUntil(page, t));
  await seek(page, 0);
  // The play again: forward seeks in steps of 250 ms, so the systems continue from the time before, as in a play.
  let from = 0;
  for (const { t, frame } of played) {
    for (let at = from + 250; at < t; at += 250) await seek(page, at);
    await seek(page, t);
    expect((await shot(page)).equals(frame), `the frame at ${String(t)} ms`).toBe(true);
    from = t;
  }
  // A seek to each earlier time gives the frame of the play too.
  for (const { t, frame } of [...played].reverse()) {
    await seek(page, t);
    expect((await shot(page)).equals(frame), `the seek back to ${String(t)} ms`).toBe(true);
  }
});

/** A screenshot of the scene page at a time on a path, in a new page. */
async function sceneShot(context: BrowserContext, worker: string, t: number): Promise<Buffer> {
  const page = await context.newPage();
  await open(page, t, worker);
  await seek(page, t);
  const frame = await shot(page);
  await page.close();
  return frame;
}

test("physics: the worker, the main thread and the player draw the same frame", async ({ context }) => {
  const worker = await sceneShot(context, "1", 5500);
  const main = await sceneShot(context, "0", 5500);
  expect((await diffFrames(context, worker, main, 0, Number.POSITIVE_INFINITY)).differ).toBe(0);
  const page = await context.newPage();
  await page.goto("/player/physics.html");
  const player = page.getByTestId("player");
  await expect(player).toHaveAttribute("data-state", "ready", READY);
  await page.evaluate(async () => {
    await document.querySelector("scenity-player")?.seek(5500);
  });
  const played = await player.screenshot({ animations: "disabled" });
  expect((await diffFrames(context, worker, played, 0, Number.POSITIVE_INFINITY)).differ).toBe(0);
});
