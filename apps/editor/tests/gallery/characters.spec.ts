// SPDX-License-Identifier: Apache-2.0
// The characters sample: a rigged robot (CC0) walks, stops and waves through the state machine of its animator, on the
// time line of its sequence. The scene page stands at fixed times of the sequence. Each frame goes against its
// baseline. A seek to the time of a paused play gives the same pixels.
// In the table scene the robot walks around a table (an `obstacle`) to a stand point behind it (`locomotion`).
// In the pickup scene the robot walks to a low table, reaches for a cup with an IK goal, and the cup attaches
// to its right hand (an attach key on `entity:robot#rightHand`) from the pickup time.
import { expect, test, type Page } from "@playwright/test";

const READY = { timeout: 30_000 };
test.describe.configure({ timeout: 90_000 });

/** The moments of the sequence `walk-wave` (its markers): idle, walk, the turn after the stop, the wave. */
const MOMENTS = [
  ["idle", 500],
  ["walk", 2500],
  ["stop", 4300],
  ["wave", 5900],
] as const;

/** The moments of the sequence `table-walk` (its markers) and their cameras: the start, the table side, the stand. */
const TABLE_MOMENTS = [
  ["start", 500, "front"],
  ["side", 2600, "front"],
  ["side-top", 2600, "top"],
  ["stand", 5000, "front"],
] as const;

/** The query of the table scene and its sequence. */
const TABLE = "&scene=scenes/table.scene.json&sequence=sequences/table-walk.sequence.json";

/** The moments of the sequence `pickup` (its markers) and their cameras: the reach, the pickup, the carry. */
const PICKUP_MOMENTS = [
  ["reach", 4500, "side"],
  ["pickup", 5000, "side"],
  ["carry", 6500, "side"],
  ["carry-front", 6500, "front"],
] as const;

/** The query of the pickup scene and its sequence. */
const PICKUP = "&scene=scenes/pickup.scene.json&sequence=sequences/pickup.sequence.json";

async function open(page: Page, t: number, query = "&camera=front"): Promise<void> {
  await page.goto(`/scene.html?project=characters${query}&paused=1&t=${String(t)}`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
}

for (const [name, t] of MOMENTS) {
  test(`characters: the robot at "${name}" (${String(t)} ms)`, async ({ page }) => {
    await open(page, t);
    await page.evaluate((time) => globalThis.__scenity?.seek?.(time), t);
    expect(await page.evaluate(() => globalThis.__scenity?.time?.())).toBe(t);
    await expect(page.getByTestId("scene-view")).toHaveScreenshot(`characters--${name}.png`);
  });
}

for (const [name, t, camera] of TABLE_MOMENTS) {
  test(`characters: the walk around the table at "${name}" (${String(t)} ms, ${camera})`, async ({ page }) => {
    await open(page, t, `${TABLE}&camera=${camera}`);
    await page.evaluate((time) => globalThis.__scenity?.seek?.(time), t);
    expect(await page.evaluate(() => globalThis.__scenity?.time?.())).toBe(t);
    await expect(page.getByTestId("scene-view")).toHaveScreenshot(`characters-table--${name}.png`);
  });
}

for (const [name, t, camera] of PICKUP_MOMENTS) {
  test(`characters: the pickup of the cup at "${name}" (${String(t)} ms, ${camera})`, async ({ page }) => {
    await open(page, t, `${PICKUP}&camera=${camera}`);
    await page.evaluate((time) => globalThis.__scenity?.seek?.(time), t);
    expect(await page.evaluate(() => globalThis.__scenity?.time?.())).toBe(t);
    await expect(page.getByTestId("scene-view")).toHaveScreenshot(`characters-pickup--${name}.png`);
  });
}

// The pickup play starts before the pickup time and stops after it, so the play crosses the attach key.
for (const [scene, query, start] of [
  ["walk-wave", "&camera=front", 1500],
  ["table-walk", `${TABLE}&camera=front`, 1500],
  ["pickup", `${PICKUP}&camera=side`, 4700],
] as const) {
  test(`characters: a seek back to the time of a paused play gives the frame of the play (${scene})`, async ({
    page,
  }) => {
    await open(page, start, query);
    await page.evaluate(() => globalThis.__scenity?.play?.());
    await page.waitForTimeout(700);
    await page.evaluate(async () => {
      globalThis.__scenity?.pause?.();
      await globalThis.__scenity?.frame();
    });
    const t = (await page.evaluate(() => globalThis.__scenity?.time?.())) ?? 0;
    expect(t).toBeGreaterThan(start);
    const played = await page.getByTestId("scene-view").screenshot();
    await page.evaluate(() => globalThis.__scenity?.seek?.(0));
    await page.evaluate((time) => globalThis.__scenity?.seek?.(time), t);
    const sought = await page.getByTestId("scene-view").screenshot();
    expect(sought.equals(played)).toBe(true);
  });
}
