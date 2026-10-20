// SPDX-License-Identifier: Apache-2.0
// The road crossing sample (samples/sim-road): the traffic plugin simulates the cars, the walkers and the push-button
// signal of a crossing (`defineSimulation`). Its system puts them and the lamps in the scene. The frames of the
// markers of the sequence `rush` go against their baselines. A play, a seek to an earlier time and a play again give
// the same pixels. The worker, the main thread and the player draw the same frame. In the play mode, a press of the
// space bar after the walk asks for the next walk. The signal changes to amber, and a replay of the recording gives
// the frame of the live play. Run it with the GPU lock and --workers=1. A failure at a load over 20 is not proof.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { diffFrames } from "../support/room3d-helpers";

const READY = { timeout: 30_000 };
test.describe.configure({ timeout: 120_000 });

/** The markers of the sequence and their cameras: the cars come, amber, the walk with a queue, the green. */
const MOMENTS = [
  ["approach", 3000, "front"],
  ["amber", 7000, "front"],
  ["queue", 12000, "front"],
  ["queue-top", 12000, "top"],
  ["kerb", 11000, "kerb"],
  ["go", 20500, "front"],
] as const;

async function open(page: Page, t: number, worker = "1", camera = "front"): Promise<void> {
  await page.goto(
    `/scene.html?project=sim-road&scene=scenes/road.scene.json&camera=${camera}&paused=1&t=${String(t)}&worker=${worker}`,
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

for (const [name, t, camera] of MOMENTS) {
  test(`sim-road: the crossing at "${name}" (${String(t)} ms, ${camera})`, async ({ page }) => {
    await open(page, t, "1", camera);
    await seek(page, t);
    expect(await page.evaluate(() => globalThis.__scenity?.time?.())).toBe(t);
    await expect(page.getByTestId("scene-view")).toHaveScreenshot(`sim-road--${name}.png`);
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

test("sim-road: a play, a seek back and a play again give the same frames", async ({ page }) => {
  await open(page, 5600);
  const played = [];
  for (const t of [6200, 7400]) played.push(await playUntil(page, t));
  await seek(page, 0);
  for (const { t, frame } of played) {
    await seek(page, t);
    expect((await shot(page)).equals(frame), `the frame at ${String(t)} ms`).toBe(true);
  }
});

/** A screenshot of the scene page at a time, in a new page. */
async function sceneShot(context: BrowserContext, worker: string, t: number): Promise<Buffer> {
  const page = await context.newPage();
  await open(page, t, worker);
  await seek(page, t);
  const frame = await shot(page);
  await page.close();
  return frame;
}

test("sim-road: the worker, the main thread and the player draw the same frame", async ({ context }) => {
  const worker = await sceneShot(context, "1", 12000);
  const main = await sceneShot(context, "0", 12000);
  expect((await diffFrames(context, worker, main, 0, Number.POSITIVE_INFINITY)).differ).toBe(0);
  const page = await context.newPage();
  await page.goto("/player/sim-road.html");
  const player = page.getByTestId("player");
  await expect(player).toHaveAttribute("data-state", "ready", READY);
  await page.evaluate(async () => {
    await document.querySelector("scenity-player")?.seek(12000);
  });
  const played = await player.screenshot({ animations: "disabled" });
  expect((await diffFrames(context, worker, played, 0, Number.POSITIVE_INFINITY)).differ).toBe(0);
});

/** The input recording of the page, as the script API gives it. */
interface Recording {
  readonly format: string;
  readonly events: readonly { readonly t: number; readonly kind: string; readonly action: string }[];
}

/** The time of the clock of the page. */
function time(page: Page): Promise<number> {
  return page.evaluate(() => globalThis.__scenity?.time?.() ?? 0);
}

test("sim-road: a press of the button in the play mode asks for the next walk", async ({ page }) => {
  await page.goto("/scene.html?project=sim-road&scene=scenes/road.scene.json&camera=front&edit=1&t=0&paused=1");
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await expect(page.getByTestId("play-start")).toBeVisible(READY);
  // The end of the walk of the sequence is at 18,500 ms (the marker "green"). A press then gives amber 6 s later.
  const END = 25_000;
  expect(await page.evaluate(() => globalThis.__scenity?.startPlay?.(undefined, { view: "scene" }))).toBeNull();
  await page.evaluate(() => globalThis.__scenity?.seek?.(19_000));
  await page.evaluate(() => globalThis.__scenity?.play?.());
  await expect.poll(() => time(page), READY).toBeGreaterThan(19_100);
  await page.keyboard.press("Space");
  await expect.poll(() => time(page), READY).toBeGreaterThan(19_400);
  await page.evaluate(() => globalThis.__scenity?.pause?.());
  const recording = await page.evaluate(() => globalThis.__scenity?.playRecording?.() as Recording | null);
  const presses = recording?.events.filter((event) => event.kind === "press").map((event) => event.action);
  expect(presses).toEqual(["traffic.button"]);
  await seek(page, END);
  const live = await shot(page);
  await page.evaluate(() => globalThis.__scenity?.stopPlay?.());
  // With no press the signal stays green at the same time: the lamps differ.
  expect(await page.evaluate(() => globalThis.__scenity?.startPlay?.(undefined, { view: "scene" }))).toBeNull();
  await seek(page, END);
  const plain = await shot(page);
  expect((await diffFrames(page.context(), live, plain, 24)).over).toBeGreaterThan(0);
  await page.evaluate(() => globalThis.__scenity?.stopPlay?.());
  // The replay of the recording gives the frame of the live play.
  expect(
    await page.evaluate((replay) => globalThis.__scenity?.startPlay?.(replay as never, { view: "scene" }), recording),
  ).toBeNull();
  await seek(page, END);
  expect((await diffFrames(page.context(), live, await shot(page), 24)).over).toBe(0);
  await page.evaluate(() => globalThis.__scenity?.stopPlay?.());
});
