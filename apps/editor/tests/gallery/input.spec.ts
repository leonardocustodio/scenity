// SPDX-License-Identifier: Apache-2.0
// The input of the play mode: a recorded play session replays to the same frames. The spec uses the spin sample
// (samples/spin, the demo plugin). The play mode of the scene page runs live. A click on the blue box stops its turn,
// and a second click starts it again. The up arrow doubles the speed, and the down arrow halves it. The page pauses at
// three times of the live play and keeps each frame. Then Stop, and a play with the recording. A seek to each of the
// three times gives the live frame (pixels over 24 levels at most 0.2 % of the canvas, the gallery tolerance). A
// click in the play mode does not change the selection (in the edit mode, it selects). The play window replays the
// recording of its handoff. The player page takes input too (`input` on <scenity-player>). The frames have no
// baselines. Run it with the GPU lock and --workers=1. A failure at a load over 20 is not proof.
import { expect, test, type Page } from "@playwright/test";
import { diffFrames } from "../support/room3d-helpers";

const READY = { timeout: 30_000 };
/** The share of the pixels that can differ by more than `LEVELS` (maxDiffPixelRatio of the gallery). */
const RATIO = 0.002;
const LEVELS = 24;
test.describe.configure({ timeout: 120_000 });

/** The input recording of the page, as the script API gives it. */
interface Recording {
  readonly format: string;
  readonly events: readonly { readonly t: number; readonly kind: string; readonly action: string }[];
}

async function openEdit(page: Page): Promise<void> {
  await page.goto("/scene.html?project=spin&scene=scenes/spin.scene.json&camera=front&edit=1&t=0&paused=1");
  const view = page.getByTestId("scene-view");
  await expect(view).toHaveAttribute("data-ready", "1", READY);
  await expect(page.getByTestId("play-start")).toBeVisible(READY);
}

/** A page point on the box `spinner`: the middle of the hits of a grid of picks over the canvas. */
async function spinnerPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="scene-view"]');
    if (canvas === null) return null;
    const hits: [number, number][] = [];
    for (let y = 8; y < canvas.clientHeight; y += 16) {
      for (let x = 8; x < canvas.clientWidth; x += 16) {
        if ((await globalThis.__scenity?.pick(x, y))?.entity === "spinner") hits.push([x, y]);
      }
    }
    const box = canvas.getBoundingClientRect();
    const middle = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1] ?? Number.NaN;
    return { x: box.left + middle(hits.map(([x]) => x)), y: box.top + middle(hits.map(([, y]) => y)) };
  });
  if (point === null || !Number.isFinite(point.x)) throw new Error("no pick hit on the spinner");
  return point;
}

function time(page: Page): Promise<number> {
  return page.evaluate(() => globalThis.__scenity?.time?.() ?? 0);
}

/** Wait until the clock of the live play is past `t`. */
async function until(page: Page, t: number): Promise<void> {
  await expect.poll(() => time(page), READY).toBeGreaterThan(t);
}

/** The frame now with no selection and no pointer over the canvas. */
async function shot(page: Page): Promise<Buffer> {
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    await globalThis.__scenity?.select?.([]);
    await globalThis.__scenity?.frame();
  });
  return page.getByTestId("scene-view").screenshot({ animations: "disabled" });
}

/** Pause the live play, keep the time and the frame, then continue the play. */
async function pauseShot(page: Page): Promise<{ t: number; frame: Buffer }> {
  await page.evaluate(() => globalThis.__scenity?.pause?.());
  const t = await time(page);
  const frame = await shot(page);
  await page.evaluate(() => globalThis.__scenity?.play?.());
  return { t, frame };
}

/** The pixels over the tolerance between two frames, and the limit of the gallery. */
async function compare(page: Page, a: Buffer, b: Buffer): Promise<{ over: number; limit: number }> {
  const diff = await diffFrames(page.context(), a, b, LEVELS);
  expect(diff.differ).not.toBe(-1);
  return { over: diff.over, limit: Math.floor(diff.width * diff.height * RATIO) };
}

/** The selection of the page editor. */
function selection(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => globalThis.__scenity?.selection?.() ?? []);
}

test("a recorded play session replays to the same frames", async ({ page }) => {
  await openEdit(page);
  const box = await spinnerPoint(page);
  // In the edit mode, a click selects the box.
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-inspector", "1", READY);
  await page.mouse.click(box.x, box.y);
  await expect.poll(() => selection(page)).toEqual(["spinner"]);
  await page.evaluate(() => globalThis.__scenity?.select?.([]));
  expect(await page.evaluate(() => globalThis.__scenity?.startPlay?.(undefined, { view: "scene" }))).toBeNull();
  // The hints show the keys of the game during the play.
  await expect(page.getByTestId("play-hints")).toBeVisible();
  expect(
    await page
      .locator('[data-testid="play-hint"]')
      .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.action)),
  ).toEqual(["demo.faster", "demo.slower", "demo.toggle"]);
  // The live play: a click stops the blue box, the up arrow doubles the speed of the red box.
  await until(page, 300);
  await page.mouse.click(box.x, box.y);
  // In the play mode a click goes to the input map only: the selection stays empty.
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.playRecording?.()?.events.length)).toBe(2);
  expect(await selection(page)).toEqual([]);
  await until(page, 700);
  await page.keyboard.press("ArrowUp");
  await until(page, 1100);
  const first = await pauseShot(page);
  await until(page, first.t + 300);
  await page.mouse.click(box.x, box.y);
  await until(page, first.t + 450);
  await page.keyboard.press("ArrowUp");
  await until(page, first.t + 900);
  const second = await pauseShot(page);
  await until(page, second.t + 400);
  await page.keyboard.press("ArrowDown");
  await until(page, second.t + 900);
  const third = await pauseShot(page);
  const recording = await page.evaluate(() => globalThis.__scenity?.playRecording?.() as Recording | null);
  expect(recording?.format).toBe("scenity.input/1");
  const presses = recording?.events.filter((event) => event.kind === "press").map((event) => event.action);
  expect(presses).toEqual(["demo.toggle", "demo.faster", "demo.toggle", "demo.faster", "demo.slower"]);
  await page.evaluate(() => globalThis.__scenity?.stopPlay?.());
  // The play window gets the recording in its handoff and replays it.
  const popup = page.waitForEvent("popup");
  expect(await page.evaluate(() => globalThis.__scenity?.playWindow?.())).toBe(true);
  const window = await popup;
  await expect(window.getByTestId("play-stage")).toHaveAttribute("data-state", "ready", READY);
  const replayed = () =>
    window.evaluate(() => {
      const player = (globalThis as { __scenityPlay?: { inputRecording?(): Recording | null } }).__scenityPlay;
      return player?.inputRecording?.()?.events ?? null;
    });
  await expect.poll(replayed, READY).toEqual(recording?.events);
  await window.close();
  // A play with no input: the same times give other frames (the input changed the frames).
  expect(await page.evaluate(() => globalThis.__scenity?.startPlay?.(undefined, { view: "scene" }))).toBeNull();
  await page.evaluate((t) => globalThis.__scenity?.seek?.(t), third.t);
  const plain = await compare(page, third.frame, await shot(page));
  expect(plain.over).toBeGreaterThan(plain.limit);
  await page.evaluate(() => globalThis.__scenity?.stopPlay?.());
  // The replay: the events of the recording at their times, and no live input.
  expect(
    await page.evaluate((replay) => globalThis.__scenity?.startPlay?.(replay as never, { view: "scene" }), recording),
  ).toBeNull();
  for (const live of [second, first, third]) {
    await page.evaluate((t) => globalThis.__scenity?.seek?.(t), live.t);
    const { over, limit } = await compare(page, live.frame, await shot(page));
    expect(over, `the replay frame at ${String(live.t)} ms`).toBeLessThanOrEqual(limit);
  }
  await page.evaluate(() => globalThis.__scenity?.stopPlay?.());
  // The saved recordings: save the last play, replay it by its name (the same frames), delete it.
  const command = (id: string, args: Record<string, unknown>) =>
    page.evaluate(([name, given]) => globalThis.__scenity?.command?.(name, given), [id, args] as const);
  await command("play.recording.save", { name: "Spin run" });
  await command("play.recordings", {});
  const row = page.locator('[data-testid="play-recording"][data-name="Spin run"]');
  await expect(row.getByTestId("play-recording-count")).toHaveText(`${String(recording?.events.length ?? 0)} events`);
  // The list closes, so the shot has only the view; the replay starts, then the clock stands at a live time.
  await command("play.recordings", {});
  await command("play.recording.replay", { name: "Spin run", view: "scene" });
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.playMode?.().active)).toBe(true);
  await page.evaluate(() => globalThis.__scenity?.frame());
  await page.evaluate((t) => globalThis.__scenity?.seek?.(t), second.t);
  const saved = await compare(page, second.frame, await shot(page));
  expect(saved.over, "the frame of the saved recording").toBeLessThanOrEqual(saved.limit);
  await page.evaluate(() => globalThis.__scenity?.stopPlay?.());
  await command("play.recordings", {});
  await row.getByTestId("play-recording-delete").click();
  await expect(row).toHaveCount(0);
  await expect(page.getByTestId("play-recordings-empty")).toBeVisible();
});

test("the player takes the input of the play mode", async ({ page }) => {
  await page.goto("/player/spin.html");
  const player = page.getByTestId("player");
  await expect(player).toHaveAttribute("data-state", "ready", READY);
  const seekShot = async (t: number): Promise<Buffer> => {
    await page.evaluate(async (at) => document.querySelector("scenity-player")?.seek(at), t);
    return player.screenshot({ animations: "disabled" });
  };
  const before = await seekShot(1500);
  await seekShot(0);
  // A click on the blue box at 0 ms stops its turn from the first step.
  const point = await page.evaluate(async () => {
    const element = document.querySelector("scenity-player");
    const canvas = element?.shadowRoot?.querySelector("canvas") ?? element?.querySelector("canvas");
    if (canvas === null || canvas === undefined) return null;
    const hits: [number, number][] = [];
    for (let y = 8; y < canvas.clientHeight; y += 16) {
      for (let x = 8; x < canvas.clientWidth; x += 16) {
        if ((await element?.player?.pick(x, y))?.entity === "spinner") hits.push([x, y]);
      }
    }
    const box = canvas.getBoundingClientRect();
    const middle = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1] ?? Number.NaN;
    return { x: box.left + middle(hits.map(([x]) => x)), y: box.top + middle(hits.map(([, y]) => y)) };
  });
  if (point === null || !Number.isFinite(point.x)) throw new Error("no pick hit on the spinner in the player");
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("scenity-player")?.player?.inputRecording?.()?.events.length),
    )
    .toBe(2);
  await page.mouse.move(0, 0);
  const after = await seekShot(1500);
  const { over, limit } = await compare(page, before, after);
  expect(over).toBeGreaterThan(limit);
});
