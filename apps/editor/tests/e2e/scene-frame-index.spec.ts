// SPDX-License-Identifier: Apache-2.0
// The Frame index panel: the index of the walkthrough sample shows in the panel. The spec starts the dev server of the
// scene page on a copy of the walkthrough sample and opens the panel. It runs "Index the project" (`scenity frames`: a
// build, then a picture of each camera at each moment of the sequence) and sees the grid of the pictures. A change of
// the sequence file then marks each picture stale. Run it alone under the GPU lock:
//   bunx --bun playwright test scene-frame-index --project=chromium --workers=1
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const WALKTHROUGH = join(LABS_ROOT, "../../samples/walkthrough");
const READY = { timeout: 60_000 };
test.describe.configure({ mode: "serial", timeout: 420_000 });

let origin = "";
let dir = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.skip(({ browserName }) => browserName !== "chromium", "the dev server runs for Chromium only");

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-frame-index-"));
  cpSync(WALKTHROUGH, dir, {
    recursive: true,
    filter: (path) => !/\/(dist|node_modules|\.scenity)$/.test(path),
  });
  server = await startSpecServer({ walk: dir });
  origin = server.origin;
  key = server.keys.walk ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

test("the index of the walkthrough sample shows in the Frame index panel; a change marks it stale", async ({
  page,
}) => {
  await page.goto(`${origin}/scene.html?project=${key}&edit=1&scene=scenes/plaza.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.frameIndex"));
  const panel = page.getByTestId("frame-index-panel");
  await expect(panel.locator("[data-empty=frameIndex]")).toBeVisible();
  await panel.getByTestId("frames-index").click();
  // A build of the copy, then 4 cameras at 0 ms and at each marker and key time of the sequence.
  const count = panel.getByTestId("frames-count");
  await expect(count).toHaveText(/^Pictures: (\d+) · frames now: \1 · stale: 0$/, { timeout: 360_000 });
  const total = Number(/Pictures: (\d+)/.exec((await count.textContent()) ?? "")?.[1]);
  expect(total).toBeGreaterThanOrEqual(8);
  const rows = panel.locator("[data-testid=frames-grid] tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(panel.getByTestId("frames-cell")).toHaveCount(total);
  await expect(panel.getByTestId("frames-cell").first()).toHaveAttribute("data-moment", "true");
  const width = await panel
    .getByTestId("frames-cell")
    .first()
    .locator("img")
    .evaluate((image: HTMLImageElement) => (image.complete ? image.naturalWidth : 0));
  expect(width).toBe(480);
  // Two picks compare two frames side by side.
  await panel.getByTestId("frames-cell").nth(0).click();
  await panel.getByTestId("frames-cell").nth(1).click();
  await expect(panel.locator("[data-testid=frames-compare] figure")).toHaveCount(2);

  // A change of the sequence file gives each frame a new key: each picture is stale until the next index.
  const file = join(dir, "sequences", "meet.sequence.json");
  const sequence = JSON.parse(readFileSync(file, "utf8")) as { name: string };
  writeFileSync(file, `${JSON.stringify({ ...sequence, name: `${sequence.name}, again` }, null, 2)}\n`);
  await page.reload();
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.frameIndex"));
  await expect(page.getByTestId("frames-count")).toHaveText(
    `Pictures: ${String(total)} · frames now: ${String(total)} · stale: ${String(total)}`,
    READY,
  );
  await expect(page.locator("[data-testid=frames-cell][data-stale]")).toHaveCount(total);
});
