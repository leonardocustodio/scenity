// SPDX-License-Identifier: Apache-2.0
// Audio: the sequence `walk-wave` of the characters sample has an audio track
// with a play key of the robot chirp at 5,200 ms (0.24 s long, an `audioSource` of the robot). The scene page plays
// the audio frames of the core with Web Audio and lists each start of a voice (`__scenity.sounds()`). A click on the
// canvas is the user gesture that starts the audio context. No screenshots: the checks read the list of the starts.
import { expect, test, type Page } from "@playwright/test";

const READY = { timeout: 30_000 };
test.describe.configure({ timeout: 60_000 });

/** The key time of the chirp and its length in ms. */
const KEY = 5200;
const LENGTH = 240;
const CHIRP = "asset:01M51C68QJY6S5M2F21R5BMPJJ";

async function open(page: Page, t: number, query = ""): Promise<void> {
  await page.goto(`/scene.html?project=characters&camera=front&paused=1&t=${String(t)}${query}`);
  const view = page.getByTestId("scene-view");
  await expect(view).toHaveAttribute("data-ready", "1", READY);
  await view.click();
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.audioState?.()), READY).toBe("running");
}

function sounds(page: Page) {
  return page.evaluate(() => [...(globalThis.__scenity?.sounds?.() ?? [])]);
}

for (const [path, query] of [
  ["worker", ""],
  ["main thread", "&worker=0"],
] as const) {
  test(`audio: a play starts the chirp at its key time (${path})`, async ({ page }) => {
    await open(page, KEY - 400, query);
    expect(await sounds(page)).toEqual([]);
    await page.evaluate(() => globalThis.__scenity?.play?.());
    await expect.poll(async () => (await sounds(page)).length, READY).toBeGreaterThan(0);
    const [first] = await sounds(page);
    expect(first).toMatchObject({ id: "track:3:0", entity: "robot", asset: CHIRP });
    const t = first?.t ?? 0;
    // The voice starts in the length of the chirp after the key, at the position of the clock in the sound.
    expect(t).toBeGreaterThanOrEqual(KEY);
    expect(t).toBeLessThan(KEY + LENGTH);
    expect(first?.position).toBe(t - KEY);
  });
}

test("audio: a seek into the chirp starts it at the right position", async ({ page }) => {
  await open(page, KEY + 100);
  // The clock stands: a still frame plays no sound.
  await page.waitForTimeout(300);
  expect(await sounds(page)).toEqual([]);
  await page.evaluate(() => globalThis.__scenity?.play?.());
  await expect.poll(async () => (await sounds(page)).length, READY).toBeGreaterThan(0);
  const [first] = await sounds(page);
  expect(first?.position).toBeGreaterThanOrEqual(100);
  expect(first?.position).toBeLessThan(LENGTH);
  expect(first?.position).toBe((first?.t ?? 0) - KEY);
});

test("audio: a seek after the end of the chirp starts nothing", async ({ page }) => {
  await open(page, KEY + LENGTH + 60);
  await page.evaluate(() => globalThis.__scenity?.play?.());
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => globalThis.__scenity?.time?.())).toBeGreaterThan(KEY + LENGTH + 500);
  expect(await sounds(page)).toEqual([]);
});
