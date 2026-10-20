// SPDX-License-Identifier: Apache-2.0
// The player: the plain HTML pages player/showroom.html and
// player/characters.html play a project with the web component <scenity-player> of @scenity/player, with no editor
// code. The release document core of the player draws the same pixels as the dev core of the scene page, so each frame
// goes against a baseline of the scene page: the showroom from its front camera (showroom.spec.ts), and the robot of
// the characters sample at two moments of its sequence (characters.spec.ts). The chirp of the robot starts at its key
// time (audio.spec.ts). Run it alone with the GPU lock and --workers=1 on a busy machine.
import { expect, test, type Page } from "@playwright/test";

const READY = { timeout: 30_000 };
test.describe.configure({ timeout: 90_000 });

/** The key time of the chirp of the robot and its length in ms (samples/characters, sequence `walk-wave`). */
const KEY = 5200;
const LENGTH = 240;
const CHIRP = "asset:01M51C68QJY6S5M2F21R5BMPJJ";

/** Open a player page and wait for the first frame with every asset. */
async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  const player = page.getByTestId("player");
  await expect(player).toHaveAttribute("data-state", "ready", READY);
  await expect(player).toHaveAttribute("data-renderer", "worker");
}

/** Stand at a time of the sequence and wait for its frame. */
async function seek(page: Page, t: number): Promise<void> {
  await page.evaluate(async (time) => {
    await document.querySelector("scenity-player")?.seek(time);
  }, t);
  expect(await page.evaluate(() => document.querySelector("scenity-player")?.currentTime)).toBe(t);
}

function sounds(page: Page) {
  return page.evaluate(() => [...(document.querySelector("scenity-player")?.player?.audio?.started ?? [])]);
}

test("player: a plain HTML page plays the showroom", async ({ page }) => {
  await open(page, "/player/showroom.html");
  const stats = await page.evaluate(() => document.querySelector("scenity-player")?.player?.stats());
  expect(stats?.drawCalls ?? 0).toBeGreaterThan(10);
  // The baseline of the scene page: the player draws the same frame.
  await expect(page.getByTestId("player")).toHaveScreenshot("showroom--front.png");
});

test("player: the robot of the characters sample moves on its sequence", async ({ page }) => {
  await open(page, "/player/characters.html");
  // The page has autoplay: the clock runs from the first frame.
  await expect
    .poll(() => page.evaluate(() => document.querySelector("scenity-player")?.currentTime), READY)
    .toBeGreaterThan(0);
  await seek(page, 500);
  await expect(page.getByTestId("player")).toHaveScreenshot("characters--idle.png");
  await seek(page, 2500);
  await expect(page.getByTestId("player")).toHaveScreenshot("characters--walk.png");
});

test("player: the chirp of the robot starts at its key time", async ({ page }) => {
  await open(page, "/player/characters.html");
  await seek(page, KEY - 400);
  // A click is the user gesture that starts the audio context.
  await page.getByTestId("player").click();
  await expect
    .poll(() => page.evaluate(() => document.querySelector("scenity-player")?.player?.audio?.state), READY)
    .toBe("running");
  expect(await sounds(page)).toEqual([]);
  await page.evaluate(() => {
    document.querySelector("scenity-player")?.play();
  });
  await expect.poll(async () => (await sounds(page)).length, READY).toBeGreaterThan(0);
  const [first] = await sounds(page);
  expect(first).toMatchObject({ entity: "robot", asset: CHIRP });
  const t = first?.t ?? 0;
  // The voice starts in the length of the chirp after the key, at the position of the clock in the sound.
  expect(t).toBeGreaterThanOrEqual(KEY);
  expect(t).toBeLessThan(KEY + LENGTH);
  expect(first?.position).toBe(t - KEY);
});
