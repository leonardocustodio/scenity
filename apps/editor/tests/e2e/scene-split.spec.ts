// SPDX-License-Identifier: Apache-2.0
// The split view of the Scene view: four views of the showroom, each with its own camera and view mode. The main view
// at the top left keeps the picks. A drag in a pane moves its camera. "Main" puts a pane into the main view. The layout
// stays after a reload. The spec times the frames of four views while the camera moves. The frame work must fit in a
// frame of 60 fps (the fps is a measure of the reference machine).
//   bunx --bun playwright test scene-split --project=chromium --workers=1
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const READY = { timeout: 60_000 };

test.describe.configure({ mode: "serial", timeout: 120_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-scene-split-"));
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"]) {
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  }
  server = await startSpecServer({ split: dir });
  origin = server.origin;
  key = server.keys.split ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

async function open(page: Page): Promise<void> {
  await page.goto(`${origin}/scene.html?project=${key}&camera=front&edit=1&scene=scenes/main.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
}

/** A picture of a box of the canvas (CSS pixels) as a base64 PNG. */
async function shot(page: Page, box: { x: number; y: number; width: number; height: number }): Promise<string> {
  const canvas = await page.getByTestId("scene-view").boundingBox();
  if (canvas === null) throw new Error("no canvas");
  const clip = { x: canvas.x + box.x + 4, y: canvas.y + box.y + 4, width: box.width - 8, height: box.height - 8 };
  // The picture shows the canvas only: the overlays, the icons and the bars of the panes change with the page.
  const hide = `#scene-overlays, #scene-view-icons, #scene-panes, #scene-gizmo, #scene-layout-tools, #scene-camera-preview,
    #scene-change-pins { visibility: hidden !important; }`;
  return (await page.screenshot({ clip, style: hide })).toString("base64");
}

/** The boxes of the four panes of the canvas (CSS pixels). */
async function quarters(page: Page) {
  const canvas = await page.getByTestId("scene-view").boundingBox();
  if (canvas === null) throw new Error("no canvas");
  const [w, h] = [Math.round(canvas.width / 2), Math.round(canvas.height / 2)];
  return [
    { x: 0, y: 0, width: w, height: h },
    { x: w, y: 0, width: w, height: h },
    { x: 0, y: h, width: w, height: h },
    { x: w, y: h, width: w, height: h },
  ];
}

const split = (page: Page) => page.evaluate(() => globalThis.__scenity?.viewport?.().split);

test("four views of the showroom: own cameras and modes, picks in the main view, Main, a reload", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.evaluate(() => globalThis.__scenity?.setViewport?.({ split: "2x2" }));
  expect(await split(page)).toEqual({
    layout: "2x2",
    panes: [
      { camera: "top", mode: null },
      { camera: "front", mode: null },
      { camera: "right", mode: null },
    ],
  });
  await expect(page.getByTestId("scene-pane")).toHaveCount(3);
  const boxes = await quarters(page);
  const [main, top, front, right] = boxes as [
    (typeof boxes)[0],
    (typeof boxes)[0],
    (typeof boxes)[0],
    (typeof boxes)[0],
  ];
  // Each pane shows its own view.
  const pictures = await Promise.all([shot(page, top), shot(page, front), shot(page, right)]);
  expect(new Set(pictures).size).toBe(3);
  // The view mode of a pane changes that pane only.
  const mainBefore = await shot(page, main);
  await page
    .locator('[data-testid="scene-pane"][data-pane="1"] [data-testid="scene-pane-mode"]')
    .selectOption("wireframe");
  await expect.poll(() => shot(page, top)).not.toBe(pictures[0]);
  expect(await shot(page, main)).toBe(mainBefore);
  await page.screenshot({ path: test.info().outputPath("four-views.png") });
  // A pick in the main view finds an entity of the showroom.
  const hit = await page.evaluate(async (box) => {
    const api = globalThis.__scenity;
    for (let y = box.height * 0.2; y < box.height * 0.9; y += 12)
      for (let x = box.width * 0.1; x < box.width * 0.9; x += 12) {
        const found = await api?.pick(x, y);
        if (found !== null && found !== undefined) return found.entity;
      }
    return null;
  }, main);
  expect(hit).not.toBeNull();
  // A drag in the top view pans its camera; the main view stays.
  const canvas = await page.getByTestId("scene-view").boundingBox();
  if (canvas === null) throw new Error("no canvas");
  const topNow = await shot(page, top);
  const [cx, cy] = [canvas.x + top.x + top.width / 2, canvas.y + top.y + top.height / 2];
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy + 40, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => shot(page, top)).not.toBe(topNow);
  expect(await shot(page, main)).toBe(mainBefore);

  // The frame work of four views while a camera moves fits in a frame of 60 fps. The GPU time is a measure of the
  // reference machine: a headless browser draws its frames late.
  const work = await page.evaluate(async () => {
    const api = globalThis.__scenity;
    const view = document.querySelector('[data-testid="scene-pane"][data-pane="3"]');
    await api?.stats(true);
    for (let step = 0; step < 30; step += 1) {
      view?.dispatchEvent(new WheelEvent("wheel", { deltaY: step % 2 === 0 ? 40 : -40, cancelable: true }));
      await api?.frame();
    }
    return (await api?.stats(false))?.workP95 ?? null;
  });
  test.info().annotations.push({ type: "frame work of four views, p95 (ms)", description: String(work) });
  expect(work).not.toBeNull();
  expect(work ?? Infinity).toBeLessThan(1000 / 60);

  // Main puts the front view into the main view, and the main view into the pane.
  await page.locator('[data-testid="scene-pane"][data-pane="2"] [data-testid="scene-pane-main"]').click();
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.viewport?.().projection)).toBe("orthographic");
  expect((await split(page))?.panes[1]?.camera).toBe("perspective");
  // The layout stays after a reload. One view removes the panes.
  await page.reload();
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await expect(page.getByTestId("scene-pane")).toHaveCount(3);
  expect((await split(page))?.panes[0]?.mode).toBe("wireframe");
  await page.evaluate(() => globalThis.__scenity?.command?.("view.split.one"));
  await expect(page.getByTestId("scene-pane")).toHaveCount(0);
  expect((await split(page))?.layout).toBe("1");
});
