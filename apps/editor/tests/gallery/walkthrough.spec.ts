// SPDX-License-Identifier: Apache-2.0
// The walkthrough sample (samples/walkthrough): two robots (CC0) walk their routes around the furniture of a plaza to
// stand points (`locomotion`). One robot lifts a parcel with an IK goal and an attach key. The robots meet, one waves
// and the other nods (the states of the animator), and a mannequin looks at them (a look goal). A tour camera moves on
// the time line. The scene page stands at the markers of the sequence `meet`, and each frame goes against its
// baseline. A seek to the time of a paused play gives the frame of the play. The player page draws the frame of the
// scene page. Run it with the GPU lock and --workers=1. A failure at a load over 20 is not proof.
import { expect, test, type Page } from "@playwright/test";

const READY = { timeout: 30_000 };
test.describe.configure({ timeout: 90_000 });

/** The markers of the sequence `meet` and their cameras. */
const MOMENTS = [
  ["start", 500, "front"],
  ["pickup", 4100, "table-view"],
  ["walk", 7800, "front"],
  ["walk-top", 7800, "top"],
  ["meet", 9700, "front"],
  ["wave", 10500, "front"],
  ["tour", 12000, "tour"],
] as const;

async function open(page: Page, t: number, camera = "front"): Promise<void> {
  await page.goto(
    `/scene.html?project=walkthrough&scene=scenes/plaza.scene.json&camera=${camera}&paused=1&t=${String(t)}`,
  );
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
}

async function seek(page: Page, t: number): Promise<void> {
  await page.evaluate(async (time) => {
    await globalThis.__scenity?.seek?.(time);
    await globalThis.__scenity?.frame();
  }, t);
  expect(await page.evaluate(() => globalThis.__scenity?.time?.())).toBe(t);
}

for (const [name, t, camera] of MOMENTS) {
  test(`walkthrough: the plaza at "${name}" (${String(t)} ms, ${camera})`, async ({ page }) => {
    await open(page, t, camera);
    await seek(page, t);
    await expect(page.getByTestId("scene-view")).toHaveScreenshot(`walkthrough--${name}.png`);
  });
}

test("walkthrough: a seek back to the time of a paused play gives the frame of the play", async ({ page }) => {
  // The play crosses the attach key of the pickup (4100 ms).
  await open(page, 3800);
  await page.evaluate(() => globalThis.__scenity?.play?.());
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.time?.() ?? 0), READY).toBeGreaterThan(4400);
  await page.evaluate(async () => {
    globalThis.__scenity?.pause?.();
    await globalThis.__scenity?.frame();
  });
  const t = (await page.evaluate(() => globalThis.__scenity?.time?.())) ?? 0;
  const played = await page.getByTestId("scene-view").screenshot();
  await seek(page, 0);
  await seek(page, t);
  expect((await page.getByTestId("scene-view").screenshot()).equals(played)).toBe(true);
});

test("walkthrough: the player page draws the frame of the scene page", async ({ page }) => {
  await page.goto("/player/walkthrough.html");
  const player = page.getByTestId("player");
  await expect(player).toHaveAttribute("data-state", "ready", READY);
  await page.evaluate(async () => {
    await document.querySelector("scenity-player")?.seek(9700);
  });
  expect(await page.evaluate(() => document.querySelector("scenity-player")?.currentTime)).toBe(9700);
  await expect(player).toHaveScreenshot("walkthrough--meet.png");
});
